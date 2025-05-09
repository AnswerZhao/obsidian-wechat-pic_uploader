# Obsidian 微信公众号图片上传插件

## 简介

这是一个 Obsidian 插件，可以帮助你将 Markdown 笔记中的图片自动上传到微信公众号，并替换为微信图片链接，从而解决在微信公众号编辑器中粘贴 Markdown 文档时图片无法显示的问题。

完全免费，无需中转或代理。

## 功能特点

- 自动上传本地图片到微信公众号并获取永久图片链接
- 支持粘贴图片时自动上传
- 支持批量上传当前文档中的所有图片
- 支持上传选中的图片
- 支持从文件选择器上传图片
- 自动替换 Markdown 中的图片链接为微信图片链接
- 支持 Obsidian 标准图片语法 `![](path/to/image.png)` 和 Obsidian 内部链接语法 `![[image.png]]`

## 安装方法

### 源码安装

1. 克隆本仓库到本地
2. 安装依赖和编译
```
npm install
npm run build
```
3. 将编译后的 main.js manifest.json 复制到你的 Obsidian 仓库空间的 `.obsidian/plugins` 目录下的 `obsidian-wechat-uploader` 目录下。可参考脚本 `update_obsidian.sh`。
4. 在 Obsidian 中启用插件

## 配置说明

首次使用时，需要在插件设置中配置微信公众号的 AppID 和 AppSecret(主界面见下图)：

1. 打开 Obsidian 设置
2. 找到「微信公众号图片上传器」设置选项
3. 填写你的微信公众号 AppID 和 AppSecret
4. 点击「刷新」按钮获取 Access Token

> 注意：AppID 和 AppSecret 可以在微信公众平台的「开发 > 基本配置」页面获取。请确保你的公众号已通过微信认证，并具有上传图片的权限。

![设置界面](assets/owu_setting.png)

## 使用方法

### 粘贴图片自动上传

1. 在设置中启用「自动上传」选项
2. 在编辑器中粘贴图片，插件会自动上传图片并替换为微信图片链接

### 上传当前文档中的所有图片

1. 打开包含图片的 Markdown 文档
2. 使用命令面板（Ctrl+P 或 Cmd+P）
3. 输入「上传当前文档中的所有图片到微信公众号」并执行
4. 或者点击左侧边栏的图片上传图标

![上传按钮](assets/btn_upload_all.png)

### 上传选中的图片

1. 在编辑器中选中包含图片链接的文本
2. 使用命令面板执行「上传当前选中的图片到微信公众号」命令

### 从文件选择器上传图片

1. 使用命令面板执行「从文件选择器上传图片到微信公众号」命令
2. 选择要上传的图片文件
3. 上传成功后，图片链接会被复制到剪贴板

## 常见问题

### Access Token 刷新失败

- 检查 AppID 和 AppSecret 是否正确
- 确认公众号是否有接口调用权限
- 检查网络连接是否正常

### 图片上传失败

- 确认图片格式是否为 JPG、PNG、GIF 等微信支持的格式
- 检查图片大小是否超过微信限制（通常为 2MB）
- 确认 Access Token 是否有效

## 注意事项

- 微信公众号 API 的 Access Token 有效期为 7200 秒（2小时），插件会自动处理 Token 刷新
- 上传的图片会永久保存在微信服务器，请勿上传敏感或违规图片
- 插件需要访问本地文件系统来读取图片文件，请确保授予相应权限

## 隐私说明

本插件仅在本地处理图片上传，不会收集或上传除图片外的任何数据。你的 AppID 和 AppSecret 仅保存在本地配置中，不会被发送到除微信服务器外的任何第三方服务器。

## 许可证

本项目采用 MIT 许可证。