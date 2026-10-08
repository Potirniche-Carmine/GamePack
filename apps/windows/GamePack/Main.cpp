#include "pch.h"
#include "GamePackModule.h"
#include "AutolinkedNativeModules.g.h"
#include <dwmapi.h>
using namespace winrt;
using namespace Windows::UI::Xaml;
using namespace Windows::UI::Xaml::Hosting;
using namespace Microsoft::ReactNative;
static DesktopWindowXamlSource island{nullptr};
static HWND islandWindow{};
static FrameworkElement appearanceRoot{nullptr};
static hstring appearance{L"system"};
void gamepack::windows::ApplyAppearance(hstring const& theme) {
  appearance=theme;
  if (appearanceRoot) appearanceRoot.RequestedTheme(theme==L"dark" ? ElementTheme::Dark : theme==L"light" ? ElementTheme::Light : ElementTheme::Default);
  DWORD light=1, size=sizeof(light);
  RegGetValueW(HKEY_CURRENT_USER,L"Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize",L"AppsUseLightTheme",RRF_RT_REG_DWORD,nullptr,&light,&size);
  BOOL dark=theme==L"dark" || (theme==L"system" && light==0);
  // Older Windows builds may decline this Windows 11 window-chrome attribute;
  // the XAML/application theme still applies on every supported version.
  if (mainWindow) DwmSetWindowAttribute(mainWindow,DWMWA_USE_IMMERSIVE_DARK_MODE,&dark,sizeof(dark));
}
static LRESULT CALLBACK WindowProcedure(HWND window, UINT message, WPARAM wParam, LPARAM lParam) {
  switch (message) {
  case WM_SIZE:
    if (islandWindow) SetWindowPos(islandWindow,nullptr,0,0,LOWORD(lParam),HIWORD(lParam),SWP_NOZORDER);
    return 0;
  case WM_DESTROY: PostQuitMessage(0); return 0;
  case WM_SETTINGCHANGE:
  case WM_THEMECHANGED:
    gamepack::windows::ApplyAppearance(appearance);
    break;
  }
  return DefWindowProcW(window,message,wParam,lParam);
}
int WINAPI wWinMain(HINSTANCE instance, HINSTANCE, PWSTR, int show) {
  init_apartment(apartment_type::single_threaded);
  try {
    SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
    Windows::System::DispatcherQueueController dispatcher{nullptr};
    if (!Windows::System::DispatcherQueue::GetForCurrentThread()) {
      DispatcherQueueOptions options{sizeof(DispatcherQueueOptions), DQTYPE_THREAD_CURRENT, DQTAT_COM_STA};
      check_hresult(CreateDispatcherQueueController(options, reinterpret_cast<ABI::Windows::System::IDispatcherQueueController**>(put_abi(dispatcher))));
    }
    auto manager=WindowsXamlManager::InitializeForCurrentThread();
    Application::Current().Resources().MergedDictionaries().Append(winrt::Microsoft::UI::Xaml::Controls::XamlControlsResources{});
    WNDCLASSEXW cls{sizeof(WNDCLASSEXW)};
    cls.lpfnWndProc=WindowProcedure; cls.hInstance=instance; cls.lpszClassName=L"GamePackWindow";
    cls.hCursor=LoadCursor(nullptr,IDC_ARROW); RegisterClassExW(&cls);
    auto window=CreateWindowExW(0,cls.lpszClassName,L"GamePack",WS_OVERLAPPEDWINDOW,CW_USEDEFAULT,CW_USEDEFAULT,1440,940,nullptr,nullptr,instance,nullptr);
    if (!window) check_win32(GetLastError());
    gamepack::windows::mainWindow=window;
    island=DesktopWindowXamlSource{};
    auto native=island.as<IDesktopWindowXamlSourceNative>();
    check_hresult(native->AttachToWindow(window)); check_hresult(native->get_WindowHandle(&islandWindow));
    ReactNativeHost host;
    host.InstanceSettings().UseDeveloperSupport(false);
    host.InstanceSettings().UseFastRefresh(false);
    host.InstanceSettings().UseDirectDebugger(false);
    wchar_t executable[MAX_PATH]{}; GetModuleFileNameW(nullptr,executable,MAX_PATH);
    auto bundle=std::filesystem::path(executable).parent_path()/L"Bundle";
    host.InstanceSettings().BundleRootPath(bundle.wstring());
    host.InstanceSettings().JavaScriptBundleFile(L"index.windows");
    RegisterAutolinkedNativeModulePackages(host.PackageProviders());
    host.PackageProviders().Append(make<gamepack::windows::PackageProvider>());
    ReactRootView root;
    root.ComponentName(L"GamePack"); root.ReactNativeHost(host);
    appearanceRoot=root;
    gamepack::windows::ApplyAppearance(appearance);
    island.Content(root);
    host.LoadInstance();
    RECT rect{}; GetClientRect(window,&rect);
    SetWindowPos(islandWindow,nullptr,0,0,rect.right,rect.bottom,SWP_SHOWWINDOW);
    ShowWindow(window,show); UpdateWindow(window);
    MSG message{};
    auto native2=island.as<IDesktopWindowXamlSourceNative2>();
    while (GetMessageW(&message,nullptr,0,0)>0) {
      BOOL handled{}; native2->PreTranslateMessage(&message,&handled);
      if (!handled) { TranslateMessage(&message); DispatchMessageW(&message); }
    }
    appearanceRoot=nullptr; island.Content(nullptr); host.UnloadInstance(); island.Close(); manager.Close();
    return 0;
  } catch (hresult_error const& error) { MessageBoxW(nullptr,error.message().c_str(),L"GamePack could not start",MB_ICONERROR); }
  catch (std::exception const& error) { MessageBoxW(nullptr,to_hstring(error.what()).c_str(),L"GamePack could not start",MB_ICONERROR); }
  return 1;
}
