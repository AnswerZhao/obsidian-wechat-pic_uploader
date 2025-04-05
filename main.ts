import { App, Editor, MarkdownView, Modal, Notice, Plugin, PluginSettingTab, Setting, TFile, requestUrl, RequestUrlParam } from 'obsidian';
import * as fs from 'fs';
import * as path from 'path';
import axios from 'axios';
// 修改 FormData 导入方式
const FormData = require('form-data');  // 使用 require 导入
import * as crypto from "crypto";

//version 1.0.0

interface WeChatUploaderSettings {
    appId: string;
    appSecret: string;
    accessToken: string;
    tokenExpireTime: number;
    autoUpload: boolean;
}

const DEFAULT_SETTINGS: WeChatUploaderSettings = {
    appId: '',
    appSecret: '',
    accessToken: '',
    tokenExpireTime: 0,
    autoUpload: true
}

export default class WeChatUploaderPlugin extends Plugin {
    settings: WeChatUploaderSettings;

    async onload() {
        await this.loadSettings();

        // 添加设置选项卡
        this.addSettingTab(new WeChatUploaderSettingTab(this.app, this));

        // 添加命令：手动上传当前文档中的所有图片
        this.addCommand({
            id: 'upload-all-images',
            name: '上传当前文档中的所有图片到微信公众号',
            editorCallback: (editor: Editor, view: MarkdownView) => {
                this.uploadAllImages(editor, view);
            }
        });

        // 添加命令：上传当前选中的图片
        this.addCommand({
            id: 'upload-selected-image',
            name: '上传当前选中的图片到微信公众号',
            editorCallback: (editor: Editor, view: MarkdownView) => {
                this.uploadSelectedImage(editor, view);
            }
        });

        // 添加命令：从文件选择器上传图片
        this.addCommand({
            id: 'upload-from-file-picker',
            name: '从文件选择器上传图片到微信公众号',
            callback: () => {
                this.uploadFromFilePicker();
            }
        });

        // 添加命令：刷新 access_token
        this.addCommand({
            id: 'refresh-access-token',
            name: '刷新微信公众号 Access Token',
            callback: () => {
                this.refreshAccessToken();
            }
        });

        // 监听粘贴事件
        this.registerEvent(
            this.app.workspace.on('editor-paste', (evt: ClipboardEvent, editor: Editor) => {
                if (this.settings.autoUpload) {
                    this.handlePaste(evt, editor);
                }
            })
        );

        // 添加状态栏项
        const statusBarItemEl = this.addStatusBarItem();
        statusBarItemEl.setText('微信图片上传器');

        // 添加功能按钮到编辑器工具栏
        this.addRibbonIcon('image-file', '上传图片到微信公众号', async () => {
            const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
            if (activeView) {
                await this.uploadAllImages(activeView.editor, activeView);
            } else {
                new Notice('请先打开一个 Markdown 文件');
            }
        });

        // 检查 access_token 是否有效，如果无效则刷新
        if (this.isAccessTokenExpired()) {
            await this.refreshAccessToken();
        }

        console.log('微信图片上传插件已加载');
    }

    async onunload() {
        console.log('微信图片上传插件已卸载');
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }

    // 检查 access_token 是否过期
    isAccessTokenExpired(): boolean {
        return !this.settings.accessToken || 
               !this.settings.tokenExpireTime || 
               Date.now() > this.settings.tokenExpireTime;
    }

    // 刷新 access_token - 使用 Obsidian 的 requestUrl API
    async refreshAccessToken(): Promise<boolean> {
        if (!this.settings.appId || !this.settings.appSecret) {
            new Notice('请先在设置中填写 AppID 和 AppSecret');
            return false;
        }
    
        try {
            // 构建请求 URL 和参数
            const url = `https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${this.settings.appId}&secret=${this.settings.appSecret}`;
            
            // 使用 Obsidian 的 requestUrl API
            const req: RequestUrlParam = {
                url: url,
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json'
                }
            };
            
            console.log('正在请求 access_token，URL:', url);
            const resp = await requestUrl(req);
            console.log('微信 API 响应:', resp.json);
            
            const respAccessToken: string = resp.json["access_token"];
            if (respAccessToken === undefined) {
                const errcode = resp.json["errcode"];
                const errmsg = resp.json["errmsg"];
                console.error('获取 Access Token 失败:', errmsg);
                new Notice(`获取 Access Token 失败: errorCode: ${errcode}, errmsg: ${errmsg}`);
                return false;
            } else {
                this.settings.accessToken = respAccessToken;
                this.settings.tokenExpireTime = Date.now() + (resp.json["expires_in"] * 1000);
                await this.saveSettings();
                new Notice('Access Token 刷新成功');
                return true;
            }
        } catch (error) {
            console.error('刷新 Access Token 时出错:', error);
            new Notice(`刷新 Access Token 失败: ${error.message}`);
            return false;
        }
    }

    // 处理粘贴事件
    async handlePaste(evt: ClipboardEvent, editor: Editor) {
        // 检查是否有图片在剪贴板中
        const items = evt.clipboardData?.items;
        if (!items) return;

        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            if (item.type.indexOf('image') !== -1) {
                evt.preventDefault(); // 阻止默认粘贴行为
                
                const blob = item.getAsFile();
                if (!blob) continue;

                // 创建临时文件路径
                const tempFilePath = this.getTempFilePath(blob);
                
                // 将 blob 转换为文件并保存
                const reader = new FileReader();
                reader.onload = async (event) => {
                    const buffer = Buffer.from(event.target?.result as ArrayBuffer);
                    fs.writeFileSync(tempFilePath, buffer);
                    
                    // 在编辑器中插入临时图片链接
                    const imageMd = `![uploading...](${tempFilePath})`;
                    editor.replaceSelection(imageMd);
                    
                    // 上传图片到微信公众号
                    try {
                        const imageUrl = await this.uploadImageToWeChat(tempFilePath);
                        if (imageUrl) {
                            // 替换临时链接为微信图片链接
                            const content = editor.getValue();
                            const newContent = content.replace(
                                `![uploading...](${tempFilePath})`, 
                                `![](${imageUrl})`
                            );
                            editor.setValue(newContent);
                            new Notice('图片已上传到微信公众号');
                        } else {
                            new Notice('图片上传失败');
                        }
                    } catch (error) {
                        console.error('上传图片时出错:', error);
                        new Notice(`上传图片失败: ${error.message}`);
                    } finally {
                        // 删除临时文件
                        if (fs.existsSync(tempFilePath)) {
                            fs.unlinkSync(tempFilePath);
                        }
                    }
                };
                reader.readAsArrayBuffer(blob);
                break; // 只处理第一个图片
            }
        }
    }

    // 获取临时文件路径
    getTempFilePath(file: File): string {
        const fileName = `pasted-${Date.now()}.${file.name.split('.').pop() || 'png'}`;
        // 修复 basePath 属性访问
        const vaultPath = (this.app.vault.adapter as any).basePath;
        const tempDir = path.join(vaultPath, '.temp');
        
        // 确保临时目录存在
        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true });
        }
        
        return path.join(tempDir, fileName);
    }

    // 上传当前选中的图片
    async uploadSelectedImage(editor: Editor, view: MarkdownView) {
        const selectedText = editor.getSelection();
        if (!selectedText) {
            new Notice('请先选择一个图片链接');
            return;
        }

        // 尝试从选中文本中提取图片链接
        const markdownImageRegex = /!\[(.*?)\]\((.*?)\)/;
        const obsidianImageRegex = /!\[\[(.*?)\]\]/;
        
        let match = selectedText.match(markdownImageRegex);
        let isObsidianFormat = false;
        
        if (!match) {
            match = selectedText.match(obsidianImageRegex);
            isObsidianFormat = true;
            
            if (!match) {
                new Notice('选中的文本不是有效的图片链接');
                return;
            }
        }

        // 确保 access_token 有效
        if (this.isAccessTokenExpired()) {
            const success = await this.refreshAccessToken();
            if (!success) {
                new Notice('无法刷新 Access Token，请检查 AppID 和 AppSecret 设置');
                return;
            }
        }
        
        try {
            let absolutePath: string | null = null;
            let altText = '';
            let imagePath = '';
            
            if (isObsidianFormat) {
                // 处理 Obsidian 内部链接格式
                const imageName = match[1];
                
                // 获取附件文件夹路径
                const attachmentFolderPath = this.getAttachmentFolderPath(view.file);
                if (!attachmentFolderPath) {
                    new Notice(`无法确定附件文件夹路径`);
                    return;
                }
                
                // 构建图片的绝对路径
                absolutePath = path.join(attachmentFolderPath, imageName);
                if (!fs.existsSync(absolutePath)) {
                    // 尝试在 vault 根目录下查找
                    const vaultPath = (this.app.vault.adapter as any).basePath;
                    const altPath = path.join(vaultPath, imageName);
                    
                    if (fs.existsSync(altPath)) {
                        absolutePath = altPath;
                    } else {
                        new Notice(`找不到图片: ${imageName}`);
                        return;
                    }
                }
            } else {
                // 处理标准 Markdown 格式
                altText = match[1];
                imagePath = match[2];
                
                // 跳过已经是 URL 的图片
                if (imagePath.startsWith('http')) {
                    new Notice('该图片已经是在线链接，无需上传');
                    return;
                }
                
                // 获取绝对路径
                absolutePath = this.getAbsoluteImagePath(imagePath, view.file);
                if (!absolutePath || !fs.existsSync(absolutePath)) {
                    new Notice(`找不到图片: ${imagePath}`);
                    return;
                }
            }
            
            // 上传图片
            new Notice('正在上传图片...');
            const imageUrl = await this.uploadImageToWeChat(absolutePath);
            if (imageUrl) {
                // 替换图片链接
                let newText;
                if (isObsidianFormat) {
                    newText = `![](${imageUrl})`;
                } else {
                    newText = `![${altText}](${imageUrl})`;
                }
                editor.replaceSelection(newText);
                new Notice('图片上传成功');
            }
        } catch (error) {
            console.error('上传图片时出错:', error);
            new Notice(`上传图片失败: ${error.message}`);
        }
    }

    // 从文件选择器上传图片
    async uploadFromFilePicker() {
        // 创建一个隐藏的文件输入元素
        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.accept = 'image/*';
        fileInput.style.display = 'none';
        document.body.appendChild(fileInput);
        
        // 监听文件选择事件
        fileInput.onchange = async (e) => {
            const files = (e.target as HTMLInputElement).files;
            if (!files || files.length === 0) {
                document.body.removeChild(fileInput);
                return;
            }
            
            // 确保 access_token 有效
            if (this.isAccessTokenExpired()) {
                const success = await this.refreshAccessToken();
                if (!success) {
                    new Notice('无法刷新 Access Token，请检查 AppID 和 AppSecret 设置');
                    document.body.removeChild(fileInput);
                    return;
                }
            }
            
            const file = files[0];
            const tempFilePath = this.getTempFilePath(file);
            
            try {
                // 读取文件内容
                const arrayBuffer = await file.arrayBuffer();
                const buffer = Buffer.from(arrayBuffer);
                fs.writeFileSync(tempFilePath, buffer);
                
                // 上传图片
                new Notice('正在上传图片...');
                const imageUrl = await this.uploadImageToWeChat(tempFilePath);
                
                if (imageUrl) {
                    // 获取当前活动编辑器
                    const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
                    if (activeView) {
                        const editor = activeView.editor;
                        // 在光标位置插入图片链接
                        editor.replaceSelection(`![](${imageUrl})`);
                        new Notice('图片上传成功并已插入到编辑器');
                    } else {
                        // 如果没有活动编辑器，则复制链接到剪贴板
                        navigator.clipboard.writeText(imageUrl);
                        new Notice('图片上传成功，链接已复制到剪贴板');
                    }
                }
            } catch (error) {
                console.error('上传图片时出错:', error);
                new Notice(`上传图片失败: ${error.message}`);
            } finally {
                // 清理临时文件
                if (fs.existsSync(tempFilePath)) {
                    fs.unlinkSync(tempFilePath);
                }
                document.body.removeChild(fileInput);
            }
        };
        
        // 触发文件选择对话框
        fileInput.click();
    }

    // 上传当前文档中的所有图片
    async uploadAllImages(editor: Editor, view: MarkdownView) {
        const content = editor.getValue();
        // 同时匹配两种格式的图片链接
        const markdownImageRegex = /!\[(.*?)\]\((.*?)\)/g;
        const obsidianImageRegex = /!\[\[(.*?)\]\]/g;
        let match;
        let newContent = content;
        let uploadCount = 0;
        let failCount = 0;

        // 确保 access_token 有效
        if (this.isAccessTokenExpired()) {
            const success = await this.refreshAccessToken();
            if (!success) {
                new Notice('无法刷新 Access Token，请检查 AppID 和 AppSecret 设置');
                return;
            }
        }

        // 处理标准 Markdown 格式的图片
        while ((match = markdownImageRegex.exec(content)) !== null) {
            const altText = match[1];
            const imagePath = match[2];
            
            // 跳过已经是 URL 的图片
            if (imagePath.startsWith('http')) continue;
            
            // 获取绝对路径
            const absolutePath = this.getAbsoluteImagePath(imagePath, view.file);
            if (!absolutePath || !fs.existsSync(absolutePath)) {
                new Notice(`找不到图片: ${imagePath}`);
                failCount++;
                continue;
            }
            
            try {
                // 上传图片
                const imageUrl = await this.uploadImageToWeChat(absolutePath);
                if (imageUrl) {
                    // 替换图片链接
                    newContent = newContent.replace(
                        `![${altText}](${imagePath})`, 
                        `![${altText}](${imageUrl})`
                    );
                    uploadCount++;
                } else {
                    failCount++;
                }
            } catch (error) {
                console.error('上传图片时出错:', error);
                new Notice(`上传图片失败: ${error.message}`);
                failCount++;
            }
        }

        // 处理 Obsidian 内部链接格式的图片
        while ((match = obsidianImageRegex.exec(content)) !== null) {
            const imageName = match[1];
            
            // 跳过已经是 URL 的图片（虽然内部链接通常不是URL）
            if (imageName.startsWith('http')) continue;
            
            // 获取附件文件夹路径
            const attachmentFolderPath = this.getAttachmentFolderPath(view.file);
            if (!attachmentFolderPath) {
                new Notice(`无法确定附件文件夹路径`);
                failCount++;
                continue;
            }
            
            // 构建图片的绝对路径
            const absolutePath = path.join(attachmentFolderPath, imageName);
            if (!fs.existsSync(absolutePath)) {
                // 尝试在 vault 根目录下查找
                const vaultPath = (this.app.vault.adapter as any).basePath;
                const altPath = path.join(vaultPath, imageName);
                
                if (!fs.existsSync(altPath)) {
                    new Notice(`找不到图片: ${imageName}`);
                    failCount++;
                    continue;
                }
            }
            
            try {
                // 上传图片
                const imageUrl = await this.uploadImageToWeChat(absolutePath);
                if (imageUrl) {
                    // 替换图片链接
                    newContent = newContent.replace(
                        `![[${imageName}]]`, 
                        `![](${imageUrl})`
                    );
                    uploadCount++;
                } else {
                    failCount++;
                }
            } catch (error) {
                console.error('上传图片时出错:', error);
                new Notice(`上传图片失败: ${error.message}`);
                failCount++;
            }
        }
        
        // 更新编辑器内容
        if (uploadCount > 0) {
            editor.setValue(newContent);
            new Notice(`成功上传 ${uploadCount} 张图片${failCount > 0 ? `，${failCount} 张失败` : ''}`);
        } else if (failCount === 0) {
            new Notice('没有找到需要上传的本地图片');
        }
    }

    // 获取附件文件夹路径
    getAttachmentFolderPath(file: TFile | null): string | null {
        if (!file) return null;
        
        // 获取 vault 根目录
        const vaultPath = (this.app.vault.adapter as any).basePath;
        
        // 尝试获取 Obsidian 配置的附件文件夹
        // 首先检查是否有专门的附件文件夹设置
        try {
            // @ts-ignore - 访问内部 API
            const attachmentFolderPath = this.app.vault.config.attachmentFolderPath;
            if (attachmentFolderPath) {
                // 如果是相对路径（以 ./ 开头）
                if (attachmentFolderPath.startsWith('./')) {
                    // 相对于当前文件的目录
                    const fileDir = path.dirname(file.path);
                    return path.join(vaultPath, fileDir, attachmentFolderPath.substring(2));
                } else {
                    // 相对于 vault 根目录
                    return path.join(vaultPath, attachmentFolderPath);
                }
            }
        } catch (e) {
            console.log('无法获取附件文件夹设置，将使用默认路径');
        }
        
        // 默认情况下，尝试几个常见的附件文件夹位置
        const possibleFolders = [
            path.join(vaultPath, 'attachments'),
            path.join(vaultPath, 'assets'),
            path.join(vaultPath, 'images'),
            path.join(vaultPath, path.dirname(file.path), 'attachments'),
            path.join(vaultPath, path.dirname(file.path), 'assets'),
            path.join(vaultPath, path.dirname(file.path), 'images'),
            path.join(vaultPath, 'Pasted Images')  // 特别针对粘贴的图片
        ];
        
        // 检查这些文件夹是否存在
        for (const folder of possibleFolders) {
            if (fs.existsSync(folder)) {
                return folder;
            }
        }
        
        // 如果都不存在，返回 vault 根目录
        return vaultPath;
    }

    // 获取图片的绝对路径
    getAbsoluteImagePath(relativePath: string, file: TFile | null): string | null {
        if (!file) return null;
        
        // 如果是绝对路径，直接返回
        if (path.isAbsolute(relativePath)) {
            return relativePath;
        }
        
        // 获取文件所在目录
        const fileDir = path.dirname(file.path);
        
        // 构建绝对路径
        // 修复 basePath 属性访问
        const vaultPath = (this.app.vault.adapter as any).basePath;
        return path.join(vaultPath, fileDir, relativePath);
    }

    // 上传图片到微信公众号 - 使用 requestUrl API
    async uploadImageToWeChat(imagePath: string): Promise<string | null> {
        if (this.isAccessTokenExpired()) {
            const success = await this.refreshAccessToken();
            if (!success) {
                throw new Error('无法刷新 Access Token');
            }
        }
        
        try {
            // 获取文件名
            const fileName = path.basename(imagePath, path.extname(imagePath));
            
            // 读取文件内容
            let blobBytes: ArrayBuffer | null = null;
            
            // 如果是网络图片
            if (imagePath.startsWith("http")) {
                const imgresp = await requestUrl(imagePath);
                blobBytes = imgresp.arrayBuffer;
            } else {
                // 读取本地文件
                blobBytes = fs.readFileSync(imagePath).buffer;
            }
            
            // 生成随机边界字符串
            const boundary = this.chooseBoundary();
            const end_boundary = '\r\n--' + boundary + '--\r\n';
            
            // 构建表单数据头部
            let formDataString = '';
            formDataString += '--' + boundary + '\r\n';
            
            // 确定内容类型
            const fileExt = path.extname(imagePath).toLowerCase().substring(1);
            let contentType = 'application/octet-stream';
            if (fileExt === 'jpg' || fileExt === 'jpeg') {
                contentType = 'image/jpeg';
            } else if (fileExt === 'png') {
                contentType = 'image/png';
            } else if (fileExt === 'gif') {
                contentType = 'image/gif';
            } else if (fileExt === 'bmp') {
                contentType = 'image/bmp';
            } else if (fileExt === 'webp') {
                contentType = 'image/webp';
            }
            
            // 添加文件信息
            formDataString += `Content-Disposition: form-data; name="media"; filename=\"${fileName}.${fileExt}\"` + '\r\n';
            formDataString += `Content-Type: ${contentType}` + '\r\n\r\n';
            
            // 转换为 Buffer
            const formDatabuffer = Buffer.from(formDataString, 'utf-8');
            let resultArray = Array.from(formDatabuffer);
            
            if (blobBytes !== null) {
                // 将图片数据转换为 Uint8Array
                let pic_typedArray = new Uint8Array(blobBytes);
                
                // 处理结束边界
                let endBoundaryArray = [];
                for (let i = 0; i < end_boundary.length; i++) {
                    endBoundaryArray.push(end_boundary.charCodeAt(i));
                }
                
                // 合并所有数据
                let postArray = resultArray.concat(Array.prototype.slice.call(pic_typedArray), endBoundaryArray);
                let post_typedArray = new Uint8Array(postArray);
                
                // 构建请求 URL
                const url = `https://api.weixin.qq.com/cgi-bin/media/uploadimg?access_token=${this.settings.accessToken}`;
                
                // 设置请求头
                const header = {
                    'Content-Type': 'multipart/form-data; boundary=' + boundary,
                    'Accept-Encoding': 'gzip, deflate, br',
                    'Accept': '*/*', 
                    'Connection': 'keep-alive',
                };
                
                // 发送请求
                const req: RequestUrlParam = {
                    url: url,
                    method: 'POST',
                    headers: header,
                    body: post_typedArray.buffer,
                };
                
                const resp = await requestUrl(req);
                const imageUrl = resp.json["url"];
                
                if (imageUrl === undefined) {
                    const errcode = resp.json["errcode"];
                    const errmsg = resp.json["errmsg"];
                    console.error('上传图片失败:', errmsg);
                    new Notice(`上传图片失败: errorCode: ${errcode}, errmsg: ${errmsg}`);
                    return null;
                }
                
                new Notice(`图片上传成功`);
                return imageUrl;
            } else {
                throw new Error('图片数据为空');
            }
        } catch (error) {
            console.error('上传图片时出错:', error);
            new Notice(`上传图片失败: ${error.message}`);
            return null;
        }
    }

    
    chooseBoundary(): string {
        const boundary = crypto.randomBytes(16).toString("hex");
        return boundary;
    }
    
    // chooseBoundary(): string {
    //     const boundary = '----WebKitFormBoundary' + crypto.randomBytes(16).toString("hex");
    //     return boundary;
    // }

    // 获取图片 URL
    async getImageUrl(mediaId: string): Promise<string | null> {
        try {
            // 注意：临时素材只能在获取后3天内使用，这里直接返回临时素材的URL
            // 如果需要永久素材，需要使用其他接口
            return `https://api.weixin.qq.com/cgi-bin/media/get?access_token=${this.settings.accessToken}&media_id=${mediaId}`;
            
            /* 
            // 如果需要使用永久素材，可以使用以下代码
            const response = await axios.post(
                `https://api.weixin.qq.com/cgi-bin/material/get_material`,
                { media_id: mediaId },
                { params: { access_token: this.settings.accessToken } }
            );
            
            if (response.data && response.data.url) {
                return response.data.url;
            } else {
                return `https://api.weixin.qq.com/cgi-bin/media/get?access_token=${this.settings.accessToken}&media_id=${mediaId}`;
            }
            */
        } catch (error) {
            console.error('获取图片 URL 时出错:', error);
            // 如果获取 URL 失败，则使用临时素材接口的 URL
            return `https://api.weixin.qq.com/cgi-bin/media/get?access_token=${this.settings.accessToken}&media_id=${mediaId}`;
        }
    }
}

class WeChatUploaderSettingTab extends PluginSettingTab {
    plugin: WeChatUploaderPlugin;

    constructor(app: App, plugin: WeChatUploaderPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const {containerEl} = this;

        containerEl.empty();

        containerEl.createEl('h2', {text: '微信公众号图片上传器设置'});

        new Setting(containerEl)
            .setName('AppID')
            .setDesc('输入你的微信公众号 AppID')
            .addText(text => text
                .setPlaceholder('AppID')
                .setValue(this.plugin.settings.appId)
                .onChange(async (value) => {
                    this.plugin.settings.appId = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('AppSecret')
            .setDesc('输入你的微信公众号 AppSecret')
            .addText(text => text
                .setPlaceholder('AppSecret')
                .setValue(this.plugin.settings.appSecret)
                .onChange(async (value) => {
                    this.plugin.settings.appSecret = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('自动上传')
            .setDesc('粘贴图片时自动上传到微信公众号')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.autoUpload)
                .onChange(async (value) => {
                    this.plugin.settings.autoUpload = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Access Token')
            .setDesc('当前的 Access Token（只读）')
            .addText(text => text
                .setValue(this.plugin.settings.accessToken || '未获取')
                .setDisabled(true));

        new Setting(containerEl)
            .setName('刷新 Access Token')
            .setDesc('点击按钮刷新 Access Token')
            .addButton(button => button
                .setButtonText('刷新')
                .setCta()
                .onClick(async () => {
                    await this.plugin.refreshAccessToken();
                    this.display(); // 刷新设置页面以显示新的 token
                }));
    }
}