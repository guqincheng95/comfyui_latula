# 拉图固定 Android 签名

正式包名：`com.latula.mobile`。旧测试包 `com.acttwomobile.app` 保留；两者数据独立，新包不会读取、清除或覆盖旧包记录。按用户后续要求，不再处理旧版兼容；后续正式版只使用固定名称、包名和证书。

版本与 Android versionCode 维护在 `frontend/version.json`；发布更新必须递增 versionCode，UI 版本必须同步。

## 证书与一次性过渡

新增长期 RSA-4096 自签名证书，别名 `latula-release-v1`，有效期 30 年。公钥证书与 SHA-256 指纹存入 `.github/signing`；私钥、密钥库和密码不能提交到仓库或公开 Release。

旧 0.01 的缓存配置未实际保存到签名私钥。核对原构建日志的 Path Validation Error，以及多份测试 APK 不同的证书指纹后，确认不能假装已有可用迁移授权链。因此新固定证书使用正式包名，与旧测试包共存；不要求先卸载旧包。新正式包后续以相同证书和包名覆盖升级。

本阶段交付仍是开发测试 APK；固定证书不能据此声称已完成 Google Play 发布配置。

## 唯一一次仓库配置

在私密备份包中找到 `LATULA_ANDROID_SIGNING.json`，将**完整内容**保存为仓库 Actions Secret：

`LATULA_ANDROID_SIGNING`

设置入口：仓库 Settings → Secrets and variables → Actions → New repository secret。

电脑已安装并登录 GitHub CLI 时，可在备份解压目录运行提供的安装脚本；该脚本只把这一份配置存入指定仓库，不创建访问令牌或扩大其他仓库权限。请勿把密钥内容发到聊天、Issue、仓库代码或日志中。

当前代码接口不支持设置 Secrets，浏览器设置页需要用户登录；是否已完成配置以签名构建真正恢复并核验身份为准。

## 后续构建规则

- 构建只从上述 Secret 恢复固定身份，并与仓库公开指纹核对。
- 没有 Secret 时清楚提示待配置，并停止生成 APK；不会回退到随机 debug key 或依赖缓存维持身份。
- 签名后使用官方 apksigner 验证 Android API 24–32 与 33–36 的同一固定证书签名，并运行模拟器检查。
- 引导工作流只用于首次建立身份；身份文件落库后拒绝再次生成证书。
- 私密备份在用户文件中保存。公开产物只有 APK、公钥证书、校验值和公开身份说明；引导传输使用 RSA-OAEP-SHA256 与 AES-256-GCM 加密，不上传裸私钥。

## 已固定的公开身份

- 应用名称：拉图 / latula。
- 包名：`com.latula.mobile`。
- 证书 SHA-256：`0f4fb840edb338a6ab9ef17c0a5bdb037f43271eba204017ee7149c23d4c1724`。
- 有效期：2026-11-15 至 2056-11-07（UTC）。
- 当前维护版本：0.01.1，versionCode 302。覆盖测试另构建 code 303，仅用于验证，不公开作为普通安装包。

证书已生成并与私钥核对；Secrets 尚需用户一次性配置。没有配置时，工作流摘要标记“Android 签名配置待完成”，且不会产出临时签名 APK。不能把该等待状态表述成长期自动构建已配置完毕。
