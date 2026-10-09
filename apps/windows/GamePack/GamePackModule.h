#pragma once
#include "pch.h"
namespace gamepack::windows {
extern HWND mainWindow;
void ApplyAppearance(winrt::hstring const& theme);
std::string DataDirectory();
bool HandleShortcut(MSG const& message);
struct PackageProvider : winrt::implements<PackageProvider, winrt::Microsoft::ReactNative::IReactPackageProvider> {
  void CreatePackage(winrt::Microsoft::ReactNative::IReactPackageBuilder const& builder) noexcept;
};
REACT_MODULE(GamePackModule, L"GamePack")
struct GamePackModule {
  winrt::Microsoft::ReactNative::ReactContext context;
  REACT_INIT(Initialize)
  void Initialize(winrt::Microsoft::ReactNative::ReactContext const& value) noexcept;
  REACT_METHOD(ConfigureShortcuts, L"configureShortcuts")
  void ConfigureShortcuts(std::vector<std::string> chords, bool recording, std::string typingShortcut) noexcept;
  REACT_METHOD(AddListener, L"addListener")
  void AddListener(std::string) noexcept {}
  REACT_METHOD(RemoveListeners, L"removeListeners")
  void RemoveListeners(double) noexcept {}
  REACT_METHOD(Command, L"command")
  void Command(std::string request, winrt::Microsoft::ReactNative::ReactPromise<std::string> promise) noexcept;
  REACT_METHOD(ChooseVideo, L"chooseVideo")
  void ChooseVideo(winrt::Microsoft::ReactNative::ReactPromise<winrt::Microsoft::ReactNative::JSValue> promise) noexcept;
  REACT_METHOD(Thumbnails, L"thumbnails")
  void Thumbnails(std::string path, std::string mediaId, winrt::Microsoft::ReactNative::ReactPromise<std::vector<std::string>> promise) noexcept;
  REACT_METHOD(Directory, L"dataDirectory")
  void Directory(winrt::Microsoft::ReactNative::ReactPromise<std::string> promise) noexcept;
  REACT_METHOD(SetAppearance, L"setAppearance")
  void SetAppearance(std::string theme) noexcept;
  REACT_METHOD(SetFullScreen, L"setFullScreen")
  void SetFullScreen(bool enabled) noexcept;
};
}
