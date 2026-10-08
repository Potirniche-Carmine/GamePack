#pragma once
#include "pch.h"
namespace gamepack::windows {
extern HWND mainWindow;
void ApplyAppearance(winrt::hstring const& theme);
std::string DataDirectory();
struct PackageProvider : winrt::implements<PackageProvider, winrt::Microsoft::ReactNative::IReactPackageProvider> {
  void CreatePackage(winrt::Microsoft::ReactNative::IReactPackageBuilder const& builder) noexcept;
};
REACT_MODULE(GamePackModule, L"GamePack")
struct GamePackModule {
  winrt::Microsoft::ReactNative::ReactContext context;
  REACT_INIT(Initialize)
  void Initialize(winrt::Microsoft::ReactNative::ReactContext const& value) noexcept { context = value; }
  REACT_METHOD(Command, L"command")
  void Command(std::string request, winrt::Microsoft::ReactNative::ReactPromise<std::string> promise) noexcept;
  REACT_METHOD(ChooseVideo, L"chooseVideo")
  void ChooseVideo(winrt::Microsoft::ReactNative::ReactPromise<winrt::Microsoft::ReactNative::JSValue> promise) noexcept;
  REACT_METHOD(Directory, L"dataDirectory")
  void Directory(winrt::Microsoft::ReactNative::ReactPromise<std::string> promise) noexcept;
  REACT_METHOD(SetAppearance, L"setAppearance")
  void SetAppearance(std::string theme) noexcept;
};
}
