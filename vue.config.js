const VuetifyLoaderPlugin = require("vuetify-loader/lib/plugin");
const path = require("path");

const trayIconName = "tray@2x.png";

module.exports = {
  lintOnSave: false,
  chainWebpack: config => { config.plugins.delete("fork-ts-checker"); },
  transpileDependencies: [
    "vuetify",
    "@opentranslate/google",
    "@opentranslate/baidu",
    "@opentranslate/caiyun",
    "@opentranslate2/niu",
    "@opentranslate2/youdao",
    "@opentranslate2/sogou",
    "@opentranslate2/translator",
    "@opentranslate2/baidu-domain",
    "@opentranslate2/aliyun",
    "@opentranslate2/azure",
    "@opentranslate2/deepl",
    "@opentranslate2/tencent",
    "@opentranslate2/tencent-smart",
    "@opentranslate2/volc",
    "@opentranslate2/yandex"
  ],
  pluginOptions: {
    electronBuilder: {
      customFileProtocol: "./",
      mainProcessTypeChecking: false,
      chainWebpackRendererProcess: (config) => {
        if (process.env.NODE_ENV === "production") config.plugin("define").tap(args => {
          const appPath = 'require("path").join(process.resourcesPath, "app.asar")';
          args[0].__dirname = appPath;
          args[0].__filename = `${appPath} + "/index.html"`;
          args[0].__static = appPath;
          args[0]["process.env"].BASE_URL = appPath;
          return args;
        });
      },
      chainWebpackMainProcess: (config) => {
        config.resolve.alias.set(
          "core-js",
          path.resolve(__dirname, "node_modules/core-js")
        );
        // 主进程也需要转译这些包
        config.module
          .rule("compile-opentranslate")
          .test(/\.js$/)
          .include
            .add(/node_modules[\\/]@opentranslate/)
            .add(/node_modules[\\/]@opentranslate2/)
            .add(/OpenTranslate[\\/]packages/)
            .end()
          .use("babel-loader")
            .loader("babel-loader")
            .options({
              presets: [
                [require.resolve("@vue/cli-plugin-babel/preset"), { targets: { node: "current" } }]
              ],
              plugins: [
                require.resolve("@babel/plugin-proposal-class-properties")
              ]
            });
        // config.when(process.env.NODE_ENV === "production", (config) => {
        //   config.plugin("analysis").use(new BundleAnalyzerPlugin());
        // });
      },
      builderOptions: {
        appId: "com.copytranslator.copytranslator",
        publish: {
          provider: "github",
          owner: "copytranslator",
          repo: "copytranslator",
        },
        asar: true,
        // uiohook-napi ships prebuilds for every supported target. Preserve the
        // target binaries when cross-packaging instead of rebuilding for the host.
        npmRebuild: false,
        artifactName: "${productName}-${version}-${os}-${arch}.${ext}",
        extraResources: [
          {
            from: `dist_locales`,
            to: `locales`,
          },
          {
            from: `external_resource`,
            to: `external_resource`,
          },
          {
            from: trayIconName,
            to: trayIconName,
          },
          { from: "icon.png", to: "icon.png" },
          { from: "icon.ico", to: "icon.ico" },
        ],
        win: {
          extraResources: [{ from: "native/windows/SelectionHelper.ps1", to: "native/SelectionHelper.ps1" }],
          icon: "icon.ico",
          target: [
            {
              target: "nsis",
              arch: ["x64"],
            },
            {
              target: "zip",
              arch: ["x64"],
            },
          ],
        },
        linux: {
          target: [
            {
              target: "AppImage",
              arch: ["x64"],
            },
            {
              target: "deb",
              arch: ["x64"],
            },
            {
              target: "rpm",
              arch: ["x64"],
            },
          ],
          maintainer: "ziqiang_xu@qq.com",
          icon: "icon.png",
          category: "Education",
          // https://www.electron.build/configuration/linux#debian-package-options
          desktop: { entry: { Icon: "/opt/copytranslator/resources/linux-icon/icon.png" } },
        },
        deb: {
          depends: ["libpng16-16"],
        },
        rpm: {
          depends: ["libpng"],
        },
        mac: {
          // Seal the whole bundle, including the Swift helper. Leaving only
          // linker signatures makes TCC attribute helper access to an unsigned
          // executable path instead of the authorized application bundle.
          identity: process.env.CSC_NAME || "-",
          binaries: ["Contents/Resources/native/selection-helper"],
          target: [{ target: "dmg", arch: [process.env.BUILD_ARCH || process.arch] }],
          icon: "icon-mac.png",
          minimumSystemVersion: "13.0",
          extraResources: [
            { from: `build/native/${process.env.BUILD_ARCH || process.arch}/selection-helper`, to: "native/selection-helper" },
            { from: "icon-mac.png", to: "icon-mac.png" },
          ],
          extendInfo: { NSAppleEventsUsageDescription: "CopyTranslator uses accessibility to read selected text for translation." },
        },
        nsis: {
          installerIcon: "icon.ico",
          oneClick: false,
          perMachine: false,
          allowToChangeInstallationDirectory: true,
          license: "readable_license.txt",
        },
      },
      externals: ["uiohook-napi", "shortcut-capture", "@electron/remote"],
      // 这一步还蛮重要的，不然就会报错
      nodeModulesPath: ["./node_modules"],
    },
  },
  configureWebpack: {
    plugins: [new VuetifyLoaderPlugin()],
    optimization: {
      usedExports: true,
    },
    resolve: {
      alias: {
        "core-js": path.resolve(__dirname, "node_modules/core-js"),
      },
    },
  },
};
