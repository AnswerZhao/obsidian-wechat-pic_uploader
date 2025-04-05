#!/bin/bash


npm run build

sleep 3

echo "start update obsidian-wechat-uploader"

cp main.js ~/Documents/obsidian/test/.obsidian/plugins/obsidian-wechat-uploader/main.js

cp package.json ~/Documents/obsidian/test/.obsidian/plugins/obsidian-wechat-uploader/package.json

echo "update obsidian-wechat-uploader success"