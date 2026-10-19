#include "pch.h"
#include "GamePackModule.h"
#include "UpdatePolicy.h"
#include "../../../native/shared/UpdateVersion.h"
#include <winrt/Windows.ApplicationModel.h>
#include <fstream>
#include <thread>
#include <cwctype>
#include <atomic>

using namespace winrt;
using namespace Microsoft::ReactNative;
using namespace Windows::Data::Json;
namespace gamepack::windows {
namespace {
std::mutex updaterMutex;
using Path = std::filesystem::path;
std::string Text(JsonObject const& value, wchar_t const* key) { return to_string(value.GetNamedString(key, L"")); }
void Put(JsonObject const& value, wchar_t const* key, std::string const& text) { value.SetNamedValue(key, JsonValue::CreateStringValue(to_hstring(text))); }
Path Executable() {
  std::wstring value(32768, L'\0');
  auto size = GetModuleFileNameW(nullptr, value.data(), static_cast<DWORD>(value.size()));
  if (!size || size >= value.size()) throw std::runtime_error("Cannot locate GamePack. Reinstall the app before updating.");
  value.resize(size); return Path(value);
}
Path Root() { return Path(to_hstring(DataDirectory()).c_str()); }
void PlainPath(Path path);
Path Cache() { PlainPath(Root()); auto path = Root() / L"updates" / L"windows"; PlainPath(path); std::filesystem::create_directories(path); return path; }
void PlainPath(Path path) {
  while (!path.empty()) {
    auto attributes = GetFileAttributesW(path.c_str());
    if (attributes != INVALID_FILE_ATTRIBUTES && (attributes & FILE_ATTRIBUTE_REPARSE_POINT)) throw std::runtime_error("Updates cannot use linked folders. Reinstall GamePack in its managed folder.");
    auto parent = path.parent_path(); if (parent == path) break; path = parent;
  }
}
std::string ProcessStart(HANDLE process) {
  FILETIME created{}, exited{}, kernel{}, user{};
  if (!GetProcessTimes(process, &created, &exited, &kernel, &user)) throw std::runtime_error("The update process could not be verified.");
  return std::to_string((static_cast<uint64_t>(created.dwHighDateTime) << 32) | created.dwLowDateTime);
}
JsonObject Read(Path const& file) {
  if (!std::filesystem::exists(file)) return JsonObject{};
  auto raw=CreateFileW(file.c_str(),GENERIC_READ,FILE_SHARE_READ|FILE_SHARE_WRITE|FILE_SHARE_DELETE,nullptr,OPEN_EXISTING,0,nullptr);
  if(raw==INVALID_HANDLE_VALUE)throw std::runtime_error("The update state could not be read. Try again.");
  handle input(raw);LARGE_INTEGER length{};
  if(!GetFileSizeEx(input.get(),&length) || length.QuadPart<0 || length.QuadPart>1048576)throw std::runtime_error("The update state is invalid. Download the update again.");
  std::string data(static_cast<size_t>(length.QuadPart),'\0');DWORD count{};
  if(!ReadFile(input.get(),data.data(),static_cast<DWORD>(data.size()),&count,nullptr) || count!=data.size())throw std::runtime_error("The update state could not be read. Try again.");
  return JsonObject::Parse(to_hstring(data));
}
void Write(Path const& file, JsonObject const& value) {
  static std::atomic<uint64_t> sequence{0};
  auto temporary = file; temporary += L"."+std::to_wstring(GetCurrentProcessId())+L"."+std::to_wstring(++sequence)+L".tmp";
  {
    std::ofstream output(temporary, std::ios::binary | std::ios::trunc);
    output << to_string(value.Stringify()); output.flush();
    if (!output) throw std::runtime_error("The update state could not be saved. Check your library folder.");
  }
  for(int attempt=0;attempt<20;++attempt) {
    if(MoveFileExW(temporary.c_str(),file.c_str(),MOVEFILE_REPLACE_EXISTING|MOVEFILE_WRITE_THROUGH))return;
    auto error=GetLastError();
    if(error!=ERROR_SHARING_VIOLATION && error!=ERROR_LOCK_VIOLATION)break;
    std::this_thread::sleep_for(std::chrono::milliseconds(25));
  }
  std::filesystem::remove(temporary);
  throw std::runtime_error("The update state could not be saved. Try again.");
}
void Fail(std::string const& message, std::string const& transaction) noexcept {
  try { auto state = Read(Cache() / L"state.json"); if(Text(state,L"transaction")!=transaction)return; Put(state, L"status", "error"); Put(state,L"error",message); Write(Cache()/L"state.json",state); } catch (...) {}
}
bool WorkerAlive(JsonObject const& state) {
  auto pid = state.GetNamedNumber(L"workerPid", 0);
  if (pid < 1 || pid > MAXDWORD) return false;
  handle process(OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION | SYNCHRONIZE, FALSE, static_cast<DWORD>(pid)));
  return process && WaitForSingleObject(process.get(), 0) == WAIT_TIMEOUT && ProcessStart(process.get()) == Text(state,L"workerStart");
}
JsonObject State() {
  auto state = Read(Cache()/L"state.json");
  auto status = Text(state,L"status");
  if (status.empty()) { Put(state,L"status","idle"); return state; }
  if (status == "downloading" || status == "verifying" || status == "installing") {
    if (!WorkerAlive(state)) {
      // Read once more: a finishing worker may have atomically committed its terminal state.
      state = Read(Cache()/L"state.json"); status = Text(state,L"status");
      if (status == "downloading" || status == "verifying" || status == "installing") {
        Put(state,L"status","error"); Put(state,L"error","The update was interrupted. Download it again."); Write(Cache()/L"state.json",state);
      }
    }
  }
  return state;
}
struct OperationLock {
  handle mutex;
  OperationLock() {
    auto root = Root().lexically_normal().wstring();
    std::transform(root.begin(),root.end(),root.begin(),[](wchar_t c){return static_cast<wchar_t>(std::towlower(c));});
    auto name = L"Local\\GamePack.Update." + std::to_wstring(std::hash<std::wstring>{}(root));
    mutex.attach(CreateMutexW(nullptr,FALSE,name.c_str()));
    if (!mutex) throw std::runtime_error("The update could not be started.");
    auto result = WaitForSingleObject(mutex.get(),0);
    if (result != WAIT_OBJECT_0 && result != WAIT_ABANDONED) throw std::runtime_error("Another update is already running.");
  }
  ~OperationLock(){ if(mutex) ReleaseMutex(mutex.get()); }
};
std::string InstalledVersion() {
  try {
    auto package = Windows::ApplicationModel::Package::Current();
    auto expected = (Root()/L"app"/L"windows").lexically_normal().wstring();
    if (package.Id().Name()!=L"GamePack" || package.Id().Publisher()!=L"CN=GamePack" || _wcsicmp(package.InstalledLocation().Path().c_str(),expected.c_str())!=0) throw std::runtime_error("Install GamePack with its bundled installer before updating in the app.");
    auto version = package.Id().Version();
    if(version.Revision != 0) throw std::runtime_error("This installed version does not support in-app updates.");
    PlainPath(Root()); PlainPath(Executable());
    return std::to_string(version.Major)+"."+std::to_string(version.Minor)+"."+std::to_string(version.Build);
  } catch(hresult_error const&) { throw std::runtime_error("Install GamePack with its bundled installer before updating in the app."); }
}
std::string Architecture() {
  USHORT process{},native{};
  if (!IsWow64Process2(GetCurrentProcess(),&process,&native)) throw std::runtime_error("This computer architecture is not supported for updates.");
  if(native==IMAGE_FILE_MACHINE_ARM64)return "arm64";
  if(native==IMAGE_FILE_MACHINE_AMD64)return "x64";
  throw std::runtime_error("This computer architecture is not supported for updates.");
}
std::string ValidateVersion(std::string const& tag,std::string const& installed) {
  auto version = ::gamepack::updates::parseStableVersion(tag);
  if(!version || !::gamepack::updates::newerStableVersion(tag,installed))throw std::runtime_error("This update is not newer than the installed app.");
  for(auto const& part : {version->major,version->minor,version->patch}) {
    if(part.size()>5 || std::stoul(part)>65535)throw std::runtime_error("This update version is unsupported on Windows.");
  }
  return version->normalized();
}
std::wstring Quote(std::wstring const& argument) {
  std::wstring result=L"\""; size_t slashes=0;
  for(auto character:argument) {
    if(character==L'\\'){++slashes;continue;}
    if(character==L'\"'){result.append(slashes*2+1,L'\\');result+=character;}
    else {result.append(slashes,L'\\');result+=character;} slashes=0;
  }
  result.append(slashes*2,L'\\');result+=L'\"';return result;
}
void CopyHelper(Path const& transaction) {
  for(auto const* name : {L"update-helper.ps1",L"update-core.psm1"}) {
    auto source=Executable().parent_path()/L"Updater"/name; PlainPath(source);
    if(!std::filesystem::is_regular_file(source))throw std::runtime_error("The update helper is missing. Reinstall GamePack.");
    std::filesystem::copy_file(source,transaction/name,std::filesystem::copy_options::overwrite_existing);
  }
}
void ParentIdentity(JsonObject const& request) {
  request.SetNamedValue(L"parentPid",JsonValue::CreateNumberValue(GetCurrentProcessId()));
  Put(request,L"parentStart",ProcessStart(GetCurrentProcess()));Put(request,L"executable",to_string(Executable().wstring()));
}
bool UseEmbeddedDefaultPolicy(Path const& executable) {
  SECURITY_ATTRIBUTES security{sizeof(SECURITY_ATTRIBUTES),nullptr,TRUE};HANDLE readRaw{},writeRaw{};
  if(!CreatePipe(&readRaw,&writeRaw,&security,0))throw std::runtime_error("Windows update policy could not be checked.");
  handle readPipe(readRaw);handle writePipe(writeRaw);
  if(!SetHandleInformation(readPipe.get(),HANDLE_FLAG_INHERIT,0))throw std::runtime_error("Windows update policy could not be checked.");
  auto inputRaw=CreateFileW(L"NUL",GENERIC_READ,FILE_SHARE_READ|FILE_SHARE_WRITE,&security,OPEN_EXISTING,0,nullptr);
  if(inputRaw==INVALID_HANDLE_VALUE)throw std::runtime_error("Windows update policy could not be checked.");
  handle input(inputRaw);
  // Restricted permits this fixed read-only command. No downloaded or bundled script is interpreted here.
  std::wstring query=L"@(Get-ExecutionPolicy -List | ForEach-Object { [pscustomobject]@{scope=[string]$_.Scope;policy=[string]$_.ExecutionPolicy} }) | ConvertTo-Json -Compress";
  auto command=Quote(executable.wstring())+L" -NoLogo -NoProfile -NonInteractive -Command "+Quote(query);
  STARTUPINFOW startup{};startup.cb=sizeof(startup);startup.dwFlags=STARTF_USESTDHANDLES;startup.hStdInput=input.get();startup.hStdOutput=writePipe.get();startup.hStdError=writePipe.get();
  PROCESS_INFORMATION info{};
  if(!CreateProcessW(executable.c_str(),command.data(),nullptr,nullptr,TRUE,CREATE_NO_WINDOW,nullptr,nullptr,&startup,&info))throw std::runtime_error("Windows blocked the update helper. Use the bundled installer to update GamePack.");
  handle process(info.hProcess);handle thread(info.hThread);writePipe.close();std::string output;
  auto deadline=std::chrono::steady_clock::now()+std::chrono::seconds(15);
  bool finished=false;
  while(std::chrono::steady_clock::now()<deadline) {
    DWORD available{};
    if(PeekNamedPipe(readPipe.get(),nullptr,0,nullptr,&available,nullptr) && available) {
      char buffer[4096];DWORD count{};
      if(!ReadFile(readPipe.get(),buffer,std::min<DWORD>(available,sizeof(buffer)),&count,nullptr))break;
      output.append(buffer,count);if(output.size()>16384)break;
    } else if(WaitForSingleObject(process.get(),0)!=WAIT_TIMEOUT){finished=true;break;}
    else std::this_thread::sleep_for(std::chrono::milliseconds(20));
  }
  DWORD code{};
  if(!finished || !GetExitCodeProcess(process.get(),&code) || code!=0){TerminateProcess(process.get(),1);throw std::runtime_error("Windows update policy could not be checked. Use the bundled installer to update GamePack.");}
  std::vector<std::pair<std::string,std::string>> policies;
  try {
    auto values=JsonArray::Parse(to_hstring(output));
    for(auto const& value:values){auto object=value.GetObject();policies.emplace_back(Text(object,L"scope"),Text(object,L"policy"));}
  } catch(...){throw std::runtime_error("Windows update policy could not be checked. Use the bundled installer to update GamePack.");}
  auto policy=::gamepack::updates::selectHelperPolicy(policies);
  if(policy==::gamepack::updates::HelperPolicy::Blocked)throw std::runtime_error("Windows policy blocks the update helper. Use the bundled installer to update GamePack.");
  return policy==::gamepack::updates::HelperPolicy::EmbeddedDefault;
}
handle Launch(Path const& transaction,std::wstring const& mode,JsonObject const& state) {
  wchar_t system[MAX_PATH]{};
  if(!GetSystemDirectoryW(system,MAX_PATH))throw std::runtime_error("Windows PowerShell could not be found.");
  auto executable=Path(system)/L"WindowsPowerShell"/L"v1.0"/L"powershell.exe";
  auto policy=UseEmbeddedDefaultPolicy(executable)?L" -ExecutionPolicy Bypass":L"";
  if(mode==L"Install")Put(state,L"status","installing");
  auto command=Quote(executable.wstring())+L" -NoLogo -NoProfile -NonInteractive"+policy+L" -File "+Quote((transaction/L"update-helper.ps1").wstring())+L" -Mode "+mode+L" -RequestFile "+Quote((transaction/L"request.json").wstring());
  STARTUPINFOW startup{};startup.cb=sizeof(startup);PROCESS_INFORMATION info{};
  if(!CreateProcessW(executable.c_str(),command.data(),nullptr,nullptr,FALSE,CREATE_NO_WINDOW|CREATE_SUSPENDED,nullptr,transaction.c_str(),&startup,&info))throw std::runtime_error("The update helper could not start. Check your Windows app policy and try again.");
  handle process(info.hProcess);handle thread(info.hThread);
  try {
    state.SetNamedValue(L"workerPid",JsonValue::CreateNumberValue(info.dwProcessId));Put(state,L"workerStart",ProcessStart(process.get()));
    Write(Cache()/L"state.json",state);
    if(ResumeThread(thread.get())==static_cast<DWORD>(-1))throw std::runtime_error("The update helper could not start.");
  } catch(...) {TerminateProcess(process.get(),1);throw;}
  return process;
}
void WaitAccepted(HANDLE process,Path const& accepted,Path const& transaction,bool installing) {
  auto deadline=std::chrono::steady_clock::now()+std::chrono::seconds(60);
  while(std::chrono::steady_clock::now()<deadline) {
    // Check exit first: a worker blocked by Windows policy must never close the app.
    if(WaitForSingleObject(process,0)!=WAIT_TIMEOUT) {
      auto state=Read(Cache()/L"state.json");auto error=Text(state,L"error");
      throw std::runtime_error(error.empty()?"The update helper could not start. Check your Windows app policy and try again.":error);
    }
    if(std::filesystem::exists(accepted))return;
    std::this_thread::sleep_for(std::chrono::milliseconds(50));
  }
  TerminateProcess(process,1);
  if(installing){std::ofstream cancel(transaction/L"cancel-install");cancel<<"cancel";}
  throw std::runtime_error("The update helper did not respond. Restart GamePack and try again.");
}
fire_and_forget Prepare(std::string tag,ReactPromise<void> promise) {
  co_await resume_background();
  bool ownsState=false;std::string ownedTransaction;
  try {
    std::lock_guard guard(updaterMutex);OperationLock operation;
    auto previous=State();auto status=Text(previous,L"status");
    if(status=="downloading" || status=="verifying" || status=="installing")throw std::runtime_error("An update is already running.");
    auto installed=InstalledVersion();auto version=ValidateVersion(tag,installed);
    GUID guid{};check_hresult(CoCreateGuid(&guid));wchar_t raw[40]{};StringFromGUID2(guid,raw,40);
    std::string id;for(auto c:std::wstring(raw))if(std::iswxdigit(c))id+=static_cast<char>(std::towlower(c));
    auto transaction=Cache()/to_hstring(id).c_str();PlainPath(transaction);std::filesystem::create_directory(transaction);CopyHelper(transaction);
    JsonObject request;Put(request,L"tag",tag);Put(request,L"version",version);Put(request,L"currentVersion",installed);Put(request,L"architecture",Architecture());Put(request,L"transaction",id);Put(request,L"dataRoot",to_string(Root().wstring()));ParentIdentity(request);
    Write(transaction/L"request.json",request);
    JsonObject state;Put(state,L"status","downloading");Put(state,L"version",version);Put(state,L"transaction",id);
    ownedTransaction=id;ownsState=true;auto process=Launch(transaction,L"Prepare",state);
    WaitAccepted(process.get(),transaction/L"prepare-accepted.json",transaction,false);
    promise.Resolve();
  } catch(std::exception const& error){if(ownsState)Fail(error.what(),ownedTransaction);promise.Reject(error.what());}
  catch(...){if(ownsState)Fail("The update could not be started. Try again.",ownedTransaction);promise.Reject("The update could not be started. Try again.");}
}
fire_and_forget CurrentState(ReactPromise<JSValue> promise) {
  co_await resume_background();
  try {
    std::lock_guard guard(updaterMutex);auto state=State();
    JSValueObject result{{"status",Text(state,L"status")}};
    auto version=Text(state,L"version");if(!version.empty())result["version"]=version;
    auto error=Text(state,L"error");if(!error.empty())result["error"]=error;
    if(state.HasKey(L"progress"))result["progress"]=std::clamp(state.GetNamedNumber(L"progress"),0.0,1.0);
    promise.Resolve(std::move(result));
  } catch(...){promise.Reject("The update state could not be read. Restart GamePack and try again.");}
}
fire_and_forget Install(ReactContext context,ReactPromise<void> promise) {
  co_await resume_background();
  bool ownsState=false;std::string ownedTransaction;
  try {
    std::lock_guard guard(updaterMutex);OperationLock operation;
    auto state=State();if(Text(state,L"status")!="ready")throw std::runtime_error("Download the update before restarting.");
    auto id=Text(state,L"transaction");
    if(id.size()!=32 || id.find_first_not_of("0123456789abcdef")!=std::string::npos)throw std::runtime_error("The update state is invalid. Download the update again.");
    auto transaction=Cache()/to_hstring(id).c_str();PlainPath(transaction);
    auto request=Read(transaction/L"request.json");auto installed=InstalledVersion();
    if(Text(request,L"dataRoot")!=to_string(Root().wstring()) || Text(request,L"transaction")!=id || Text(request,L"architecture")!=Architecture() || Text(request,L"currentVersion")!=installed)throw std::runtime_error("The installed app changed. Download the update again.");
    ValidateVersion(Text(request,L"tag"),installed);ParentIdentity(request);CopyHelper(transaction);Write(transaction/L"request.json",request);
    std::filesystem::remove(transaction/L"install-accepted.json");std::filesystem::remove(transaction/L"cancel-install");std::filesystem::remove(transaction/L"install-permitted.json");
    ownedTransaction=id;ownsState=true;auto process=Launch(transaction,L"Install",state);
    WaitAccepted(process.get(),transaction/L"install-accepted.json",transaction,true);
    // The shared UI has flushed drafts before calling this method. WM_CLOSE uses the normal shutdown path.
    auto worker=std::make_shared<handle>(std::move(process));
    context.UIDispatcher().Post([promise,transaction,worker,id](){
      try {
        if(!mainWindow || !IsWindow(mainWindow) || WaitForSingleObject(worker->get(),0)!=WAIT_TIMEOUT)throw std::runtime_error("GamePack could not restart. Try the update again.");
        JsonObject permission;permission.SetNamedValue(L"workerPid",JsonValue::CreateNumberValue(GetProcessId(worker->get())));
        // A timed-out or rejected invocation never creates this explicit commit permission.
        Write(transaction/L"install-permitted.json",permission);
        if(!PostMessageW(mainWindow,WM_CLOSE,0,0)){
          std::filesystem::remove(transaction/L"install-permitted.json");
          throw std::runtime_error("GamePack could not close. Restart the app and try again.");
        }
        promise.Resolve();
      } catch(...) {
        // This owned worker cannot have started replacement while the parent is still alive.
        TerminateProcess(worker->get(),1);
        std::ofstream cancel(transaction/L"cancel-install");cancel<<"cancel";
        Fail("GamePack could not restart. Try the update again.",id);promise.Reject("GamePack could not restart. Try the update again.");
      }
    });
  } catch(std::exception const& error){if(ownsState)Fail(error.what(),ownedTransaction);promise.Reject(error.what());}
  catch(...){if(ownsState)Fail("The update could not be installed. Try again.",ownedTransaction);promise.Reject("The update could not be installed. Try again.");}
}
}
void GamePackModule::PrepareUpdate(std::string tag,ReactPromise<void> promise) noexcept{Prepare(std::move(tag),promise);}
void GamePackModule::UpdateState(ReactPromise<JSValue> promise) noexcept{CurrentState(promise);}
void GamePackModule::InstallUpdate(ReactPromise<void> promise) noexcept{Install(context,promise);}
}
