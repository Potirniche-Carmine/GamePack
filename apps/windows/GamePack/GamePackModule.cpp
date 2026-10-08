#include "pch.h"
#include "GamePackModule.h"
#include "GamePackPlayer.h"
#include <fstream>
#include "gamepack-core/src/lib.rs.h"

using namespace winrt;
using namespace Microsoft::ReactNative;
namespace gamepack::windows {
HWND mainWindow{};
static std::mutex coreMutex;
static std::wstring Environment(wchar_t const* key) {
  auto size = GetEnvironmentVariableW(key, nullptr, 0);
  if (!size) return {};
  std::wstring value(size, L'\0');
  value.resize(GetEnvironmentVariableW(key, value.data(), size));
  return value;
}
std::string DataDirectory() {
  auto path = Environment(L"GAMEPACK_HOME");
  if (path.empty()) {
    std::wstring executable(32768,L'\0');
    auto length=GetModuleFileNameW(nullptr,executable.data(),static_cast<DWORD>(executable.size()));
    if (!length || length>=executable.size()) throw std::runtime_error("Cannot locate the installed application.");
    executable.resize(length);
    std::ifstream marker(std::filesystem::path(executable).parent_path()/L"gamepack-root.txt",std::ios::binary);
    if (marker) {
      std::string saved((std::istreambuf_iterator<char>(marker)),std::istreambuf_iterator<char>());
      path=to_hstring(saved).c_str();
    }
  }
  if (path.empty()) {
    auto profile = Environment(L"USERPROFILE");
    if (profile.empty()) throw std::runtime_error("USERPROFILE is unavailable. Set GAMEPACK_HOME to a writable absolute directory.");
    path = (std::filesystem::path(profile) / L".gamepack").wstring();
  }
  auto root = std::filesystem::path(path);
  if (!root.is_absolute()) throw std::runtime_error("GAMEPACK_HOME must be an absolute path.");
  std::filesystem::create_directories(root);
  return to_string(root.wstring());
}
static fire_and_forget Dispatch(std::string request, ReactPromise<std::string> promise) {
  co_await resume_background();
  try {
    std::lock_guard lock(coreMutex);
    auto root = DataDirectory();
    auto result = ::gamepack::dispatch(rust::Str(root), rust::Str(request));
    promise.Resolve(std::string(result));
  } catch (std::exception const& error) { promise.Reject(error.what()); }
  catch (...) { promise.Reject("Native core failed. Check that the GamePack data folder is writable."); }
}
void GamePackModule::Command(std::string request, ReactPromise<std::string> promise) noexcept { Dispatch(std::move(request), promise); }
void GamePackModule::Directory(ReactPromise<std::string> promise) noexcept {
  try { promise.Resolve(DataDirectory()); } catch (std::exception const& error) { promise.Reject(error.what()); }
}
void GamePackModule::SetAppearance(std::string theme) noexcept {
  if (theme != "system" && theme != "light" && theme != "dark") return;
  context.UIDispatcher().Post([theme=std::move(theme)]() {
    try { ApplyAppearance(to_hstring(theme)); } catch (...) {}
  });
}
void GamePackModule::ChooseVideo(ReactPromise<JSValue> promise) noexcept {
  context.UIDispatcher().Post([promise]() {
    try {
      com_ptr<IFileOpenDialog> dialog;
      check_hresult(CoCreateInstance(CLSID_FileOpenDialog, nullptr, CLSCTX_INPROC_SERVER, IID_PPV_ARGS(dialog.put())));
      COMDLG_FILTERSPEC filters[]{{L"Video files", L"*.mp4;*.mov;*.m4v;*.avi;*.wmv;*.mkv;*.webm"}, {L"All files", L"*.*"}};
      check_hresult(dialog->SetFileTypes(2, filters));
      FILEOPENDIALOGOPTIONS options{};
      check_hresult(dialog->GetOptions(&options));
      check_hresult(dialog->SetOptions(options | FOS_FORCEFILESYSTEM | FOS_FILEMUSTEXIST | FOS_PATHMUSTEXIST));
      auto result = dialog->Show(mainWindow);
      if (result == HRESULT_FROM_WIN32(ERROR_CANCELLED)) { promise.Resolve(JSValue{}); return; }
      check_hresult(result);
      com_ptr<IShellItem> item;
      check_hresult(dialog->GetResult(item.put()));
      PWSTR raw{};
      check_hresult(item->GetDisplayName(SIGDN_FILESYSPATH, &raw));
      std::wstring path(raw);
      CoTaskMemFree(raw);
      promise.Resolve(JSValue(to_string(path)));
    } catch (hresult_error const& error) { promise.Reject(to_string(error.message()).c_str()); }
  });
}
void PackageProvider::CreatePackage(IReactPackageBuilder const& builder) noexcept {
  AddAttributedModules(builder, true);
  builder.AddViewManager(L"GamePackPlayer", [] { return make<PlayerManager>(); });
}
}
