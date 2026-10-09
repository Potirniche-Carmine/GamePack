#include "pch.h"
#include "GamePackModule.h"
#include "GamePackPlayer.h"
#include <fstream>
#include "gamepack-core/src/lib.rs.h"

using namespace winrt;
using namespace Microsoft::ReactNative;
namespace gamepack::windows {
HWND mainWindow{};
static ReactContext shortcutContext;
static std::vector<std::string> shortcuts;
static bool recordingShortcut{};
static std::string typingShortcut;
void GamePackModule::Initialize(ReactContext const& value) noexcept { context=value; shortcutContext=value; }
void GamePackModule::ConfigureShortcuts(std::vector<std::string> chords, bool recording, std::string typing) noexcept {
  context.UIDispatcher().Post([chords=std::move(chords),recording,typing=std::move(typing)]() {
    shortcuts=chords; recordingShortcut=recording; typingShortcut=typing;
  });
}
bool HandleShortcut(MSG const& message) {
  if (message.message!=WM_KEYDOWN && message.message!=WM_SYSKEYDOWN) return false;
  if (GetAncestor(message.hwnd,GA_ROOT)!=mainWindow || GetForegroundWindow()!=mainWindow) return false;
  std::string key;
  switch (message.wParam) {
    case VK_LEFT: key="ArrowLeft"; break; case VK_RIGHT: key="ArrowRight"; break;
    case VK_UP: key="ArrowUp"; break; case VK_DOWN: key="ArrowDown"; break;
    case VK_SPACE: key="Space"; break; case VK_RETURN: key="Enter"; break;
    case VK_BACK: key="Backspace"; break; case VK_DELETE: key="Delete"; break;
    case VK_HOME: key="Home"; break; case VK_END: key="End"; break;
    case VK_PRIOR: key="PageUp"; break; case VK_NEXT: key="PageDown"; break;
    case VK_ESCAPE: key="Escape"; break; case VK_TAB: return false;
    case VK_OEM_COMMA: key=","; break; case VK_OEM_PERIOD: key="."; break;
    case VK_OEM_1: key=";"; break; case VK_OEM_2: key="/"; break;
    case VK_OEM_4: key="["; break; case VK_OEM_6: key="]"; break;
    case VK_OEM_7: key="'"; break; case VK_OEM_MINUS: key="-"; break;
    case VK_OEM_PLUS: key="="; break;
    default:
      if (message.wParam>='A' && message.wParam<='Z') key=static_cast<char>(message.wParam);
      else if (message.wParam>='0' && message.wParam<='9') key=static_cast<char>(message.wParam);
      else return false;
  }
  bool control=(GetKeyState(VK_CONTROL)&0x8000)!=0, alt=(GetKeyState(VK_MENU)&0x8000)!=0;
  if ((GetKeyState(VK_LWIN)&0x8000) || (GetKeyState(VK_RWIN)&0x8000) || (control && (GetKeyState(VK_RMENU)&0x8000))) return false;
  std::string chord=(control ? "Mod+" : "");
  if (alt) chord+="Alt+";
  if (GetKeyState(VK_SHIFT)&0x8000) chord+="Shift+";
  chord+=key;
  auto focus=Windows::UI::Xaml::Input::FocusManager::GetFocusedElement();
  bool editing=focus && (focus.try_as<Windows::UI::Xaml::Controls::TextBox>() || focus.try_as<Windows::UI::Xaml::Controls::RichEditBox>() || focus.try_as<Windows::UI::Xaml::Controls::PasswordBox>());
  if (!recordingShortcut && (std::find(shortcuts.begin(),shortcuts.end(),chord)==shortcuts.end() || (editing && chord!=typingShortcut && chord!="Escape"))) return false;
  JSValueObject payload{{"chord",chord},{"repeat",(message.lParam & (1LL<<30))!=0}};
  if (!recordingShortcut && editing && chord==typingShortcut) {
    if (auto input=focus.try_as<Windows::UI::Xaml::Controls::TextBox>()) payload["text"]=to_string(input.Text());
    else if (auto input=focus.try_as<Windows::UI::Xaml::Controls::RichEditBox>()) {
      hstring text;
      input.Document().GetText(Windows::UI::Text::TextGetOptions::None,text);
      payload["text"]=to_string(text);
    }
  }
  shortcutContext.EmitJSEvent(L"RCTDeviceEventEmitter", L"GamePackShortcut", std::move(payload));
  return true;
}
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
void GamePackModule::SetFullScreen(bool enabled) noexcept {
  context.UIDispatcher().Post([enabled]() {
    static bool fullScreen{};
    static WINDOWPLACEMENT placement{sizeof(WINDOWPLACEMENT)};
    static LONG_PTR style{};
    if (!mainWindow || enabled==fullScreen) return;
    if (enabled) {
      style=GetWindowLongPtrW(mainWindow,GWL_STYLE);
      GetWindowPlacement(mainWindow,&placement);
      MONITORINFO monitor{sizeof(MONITORINFO)};
      if (!GetMonitorInfoW(MonitorFromWindow(mainWindow,MONITOR_DEFAULTTONEAREST),&monitor)) return;
      SetWindowLongPtrW(mainWindow,GWL_STYLE,style & ~WS_OVERLAPPEDWINDOW);
      SetWindowPos(mainWindow,HWND_TOP,monitor.rcMonitor.left,monitor.rcMonitor.top,monitor.rcMonitor.right-monitor.rcMonitor.left,monitor.rcMonitor.bottom-monitor.rcMonitor.top,SWP_FRAMECHANGED);
    } else {
      SetWindowLongPtrW(mainWindow,GWL_STYLE,style);
      SetWindowPlacement(mainWindow,&placement);
      SetWindowPos(mainWindow,nullptr,0,0,0,0,SWP_NOMOVE|SWP_NOSIZE|SWP_NOZORDER|SWP_FRAMECHANGED);
    }
    fullScreen=enabled;
    shortcutContext.EmitJSEvent(L"RCTDeviceEventEmitter",L"GamePackWindowState",JSValueObject{{"fullScreen",enabled}});
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
