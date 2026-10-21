#import <AppKit/AppKit.h>
#import <objc/runtime.h>
#include <node_api.h>
#include <cstring>

// Electron's NSPanel override adds CanJoinAllSpaces on every assignment.
// Use the public NSWindow implementation for these app-owned panels only.
// No global swizzling, private WindowServer APIs, polling or extra permissions.
static void SetBehavior(NSWindow *window, bool presenting) {
  auto behavior = window.collectionBehavior;
  behavior &= ~(NSWindowCollectionBehaviorCanJoinAllSpaces |
                NSWindowCollectionBehaviorMoveToActiveSpace |
                NSWindowCollectionBehaviorTransient |
                NSWindowCollectionBehaviorStationary |
                NSWindowCollectionBehaviorFullScreenPrimary |
                NSWindowCollectionBehaviorFullScreenNone);
  behavior |= NSWindowCollectionBehaviorManaged |
              NSWindowCollectionBehaviorFullScreenAuxiliary;
  if (presenting) behavior |= NSWindowCollectionBehaviorMoveToActiveSpace;
  auto setter = reinterpret_cast<void (*)(id, SEL, NSWindowCollectionBehavior)>(
      class_getMethodImplementation([NSWindow class], @selector(setCollectionBehavior:)));
  setter(window, @selector(setCollectionBehavior:), behavior);
}

static NSWindow *Window(napi_env env, napi_callback_info info) {
  size_t argc = 1, size = 0;
  napi_value arg;
  void *data = nullptr;
  if (napi_get_cb_info(env, info, &argc, &arg, nullptr, nullptr) != napi_ok || argc != 1 ||
      napi_get_buffer_info(env, arg, &data, &size) != napi_ok || size != sizeof(void *)) {
    napi_throw_type_error(env, nullptr, "Expected an Electron native window handle");
    return nil;
  }
  if (![NSThread isMainThread]) {
    napi_throw_error(env, nullptr, "Popup windows must be accessed on the main thread");
    return nil;
  }
  // Only the trusted main process calls this with a live BrowserWindow's NSView.
  void *pointer = nullptr;
  std::memcpy(&pointer, data, sizeof(pointer));
  NSView *view = (__bridge NSView *)pointer;
  NSWindow *window = view.window;
  if (!window) napi_throw_error(env, nullptr, "Popup window has been destroyed");
  return window;
}

static napi_value Prepare(napi_env env, napi_callback_info info) {
  NSWindow *window = Window(env, info);
  if (!window) return nullptr;
  SetBehavior(window, true);
  napi_value result; napi_get_undefined(env, &result); return result;
}

static napi_value Settle(napi_env env, napi_callback_info info) {
  NSWindow *window = Window(env, info);
  if (!window) return nullptr;
  SetBehavior(window, false);
  napi_value result; napi_get_undefined(env, &result); return result;
}

static napi_value IsOnActiveSpace(napi_env env, napi_callback_info info) {
  NSWindow *window = Window(env, info);
  if (!window) return nullptr;
  napi_value result; napi_get_boolean(env, window.onActiveSpace, &result); return result;
}

static napi_value Init(napi_env env, napi_value exports) {
  napi_property_descriptor properties[] = {
      {"prepare", nullptr, Prepare, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"settle", nullptr, Settle, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"isOnActiveSpace", nullptr, IsOnActiveSpace, nullptr, nullptr, nullptr, napi_default, nullptr},
  };
  napi_define_properties(env, exports, 3, properties);
  return exports;
}
NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)
