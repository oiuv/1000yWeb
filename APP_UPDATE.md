# Android更新配置

固定公开地址：`https://1000y.gameivy.com/app-update.json`。文件在`public/app-update.json`，无需登录；服务端响应带`Cache-Control: no-store`。反向代理/CDN也应对这个路径禁用缓存。

APP启动时读取版本及下载地址，网站仅提供配置，APK可继续放OSS。Release与Debug各有独立通道；`debug: null`表示不发布开发版更新。

| 字段 | 含义 |
| --- | --- |
| schema_version | 固定1 |
| package_name | 正式版com.gameivy.yanhuang，开发版末尾加.dev |
| version_code | APK实际整数版本号，必须递增；不是展示版本字符串 |
| version_name | 如0.1.110，仅供显示 |
| min_sdk | 最低Android API级别，当前24 |
| url | 带具体版本号的APK HTTPS直链，如`https://oiuv.oss-accelerate.aliyuncs.com/1000y/1000y-0.1.110.apk`；不填`latest`地址，不使用重定向 |
| size_bytes | APK准确字节数 |
| sha256 | APK的64位SHA-256，小写十六进制 |
| notes | 最多6条更新说明，每条最多100字，不含换行 |

先构建、签名、上传安装包并确认直链，再更新JSON并部署网站。可用`Get-Item`的Length获取字节数，`Get-FileHash -Algorithm SHA256`获取哈希，Android SDK的`aapt dump badging`读取包名、versionCode和最低系统版本。请勿填猜测值或重命名其他包来代替同签名更新。

0.1.109及以前的APP没有检查更新逻辑，需要先手动覆盖安装支持更新的0.1.110或更新版本；以后才按此清单提示。

## 网站下载与APP更新

- 网站下载按钮和二维码使用固定入口：`https://oiuv.oss-accelerate.aliyuncs.com/1000y/1000y-latest.apk`。网页不显示写死的版本号和安装包大小，不必随版本修改。
- APP更新配置的`url`使用具体版本地址，例如`https://oiuv.oss-accelerate.aliyuncs.com/1000y/1000y-0.1.110.apk`。该文件发布后保持不变，旧版本文件也保留，避免用户确认更新后下载到另一版本、导致校验失败。
- 每次发版先上传具体版本APK并验证，再将同一文件覆盖到`1000y-latest.apk`；核对两份文件一致后，更新本配置的版本、大小、SHA-256和说明并部署。
- 对OSS的`1000y-latest.apk`设置`Cache-Control: no-cache`，让重复下载时重新验证文件；如另有CDN缓存，覆盖后刷新对应缓存。`app-update.json`继续禁用缓存。
- 二维码为本地静态图片`public/images/android-download-qr.png`，直接编码固定下载地址，无需第三方二维码服务，也无需逐版重新生成。

验证：`node --test tests/app-update.test.js`，或执行全部`npm test`。发布后检查公网地址返回JSON且不缓存，再用旧版支持更新的APP实际更新；本地测试不能替代公网下载验收。

## HTTPS入口要求

必须发送站点证书和完整中间证书链，不能只安装单张站点证书。浏览器可能缓存或补全中间证书，但Godot不会因此忽略校验错误。Nginx的`ssl_certificate`应指向证书工具生成的`fullchain.pem`；使用ZeroSSL下载包时应按站点证书在前、`ca_bundle.crt`在后的顺序安装证书链。私钥保持对应，不进入仓库。参考[ZeroSSL中间证书说明](https://help.zerossl.com/hc/en-us/articles/360058296114-Missing-Intermediate-Certificate)。

部署后可用`openssl s_client -connect 1000y.gameivy.com:443 -servername 1000y.gameivy.com -showcerts -verify_return_error -CAfile /path/to/trusted-ca-bundle.crt`核对实际发送的链和可信根验证结果，并在Android中验证。代理或浏览器打开成功不能代替APP的TLS验证。客户端不关闭证书校验，不内置易过期的站点证书。
