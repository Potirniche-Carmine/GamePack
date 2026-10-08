#pragma once
#include "pch.h"
namespace gamepack::windows {
struct PlayerState;
struct PlayerManager : winrt::implements<PlayerManager,
  winrt::Microsoft::ReactNative::IViewManager,
  winrt::Microsoft::ReactNative::IViewManagerWithReactContext,
  winrt::Microsoft::ReactNative::IViewManagerWithNativeProperties,
  winrt::Microsoft::ReactNative::IViewManagerWithExportedEventTypeConstants,
  winrt::Microsoft::ReactNative::IViewManagerWithDropViewInstance> {
  winrt::Microsoft::ReactNative::IReactContext ReactContext() noexcept { return context; }
  void ReactContext(winrt::Microsoft::ReactNative::IReactContext const& value) noexcept { context = value; }
  winrt::hstring Name() noexcept { return L"GamePackPlayer"; }
  winrt::Windows::UI::Xaml::FrameworkElement CreateView() noexcept;
  winrt::Windows::Foundation::Collections::IMapView<winrt::hstring, winrt::Microsoft::ReactNative::ViewManagerPropertyType> NativeProps() noexcept;
  void UpdateProperties(winrt::Windows::UI::Xaml::FrameworkElement const& view, winrt::Microsoft::ReactNative::IJSValueReader const& reader) noexcept;
  winrt::Microsoft::ReactNative::ConstantProviderDelegate ExportedCustomBubblingEventTypeConstants() noexcept { return nullptr; }
  winrt::Microsoft::ReactNative::ConstantProviderDelegate ExportedCustomDirectEventTypeConstants() noexcept;
  void OnDropViewInstance(winrt::Windows::UI::Xaml::FrameworkElement const& view) noexcept;
  winrt::Microsoft::ReactNative::IReactContext context{nullptr};
  std::map<void*, std::shared_ptr<PlayerState>> players;
};
}
