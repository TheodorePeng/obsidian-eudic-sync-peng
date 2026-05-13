# Eudic Sync

Eudic Sync is an Obsidian plugin for managing English word notes and syncing selected note content to Eudic.

It is built for a workflow where Obsidian remains the writing and review space, while Eudic stores the final synced word notes and studylist assignments.

## What it does

- Syncs managed Obsidian word notes to Eudic.
- Tracks dirty/synced state before pushing note content.
- Syncs and repairs Eudic studylist assignment metadata.
- Supports managed reference notes embedded from word notes.
- Renders semantic `eudic-block` sections for preview and final Eudic output.
- Provides commands for syncing, repairing metadata, formatting markers, and extracting references.
- Adds optional note header and status bar sync controls.

## Before you use it

1. Install the plugin in Obsidian.
2. Open Eudic Sync settings.
3. Set the word notes folder and reference notes folder.
4. Add your Eudic Authorization token.
5. Test with one word note before syncing a larger set.

The default folder examples are:

- `Eudic/Words`
- `Eudic/References`

## Common commands

- `Sync current word`
- `Sync all dirty words`
- `Refresh Eudic studylists`
- `Pull studylist assignments from Eudic`
- `Push all dirty studylist assignments to Eudic`
- `Rebuild reference graph`
- `Repair All reference metadata`
- `Format current Eudic note bold markers`
- `Create reference from selection`
- `Extract current Eudic block to reference`
- `Wrap selection as Eudic block`
- `Insert Eudic block`

## Install with BRAT

1. Install the [BRAT](https://github.com/TfTHacker/obsidian42-brat) plugin from Obsidian Community Plugins.
2. Enable BRAT.
3. In BRAT, choose the option to add a beta plugin.
4. Paste this repository URL:

   `https://github.com/TheodorePeng/obsidian-eudic-sync-peng`

5. Confirm the install, then enable Eudic Sync in Obsidian.

## Update with BRAT

1. New versions are published through GitHub Releases.
2. The release tag matches the plugin version in `manifest.json`.
3. BRAT downloads the release assets for the plugin files.
4. After updating, reload Obsidian if needed.

## Requirements

- Obsidian 1.7.7 or later
- A Eudic account and Eudic Authorization token
- Network access to the Eudic API

## Privacy and local data

- Your Eudic Authorization token is stored by Obsidian in the local plugin settings file, usually `data.json`.
- `data.json` is intentionally ignored by Git and should not be committed or published.
- Exported settings backups can include the Eudic Authorization token. Treat exported backups as sensitive files.
- The plugin sends selected managed note content and studylist operations to Eudic when you run sync-related commands.

## Repository layout

- `src/` contains the TypeScript source code.
- `main.js` is the bundled plugin entry file used by Obsidian and BRAT releases.
- `styles.css` contains plugin styles.
- `manifest.json` and `versions.json` are used for Obsidian and BRAT releases.
- `tests/` contains local unit and behavior tests.
- `data.json` is local settings data and should not be committed.
- `eudic-sync-original-base.zip` is the original base version archive of this plugin. It can be used as a recovery starting point if the project needs to be rebuilt from scratch.

---

# Eudic Sync 中文说明

Eudic Sync 是一个 Obsidian 插件，用于管理英语单词笔记，并将选定的笔记内容同步到欧路词典。

它适合这样的工作流：在 Obsidian 中写作、整理和复习单词笔记，再把最终需要同步的内容写入欧路词典。

## 主要功能

- 将受管理的 Obsidian 单词笔记同步到欧路词典。
- 在推送笔记内容前追踪 dirty/synced 状态。
- 同步和修复欧路词典生词本分类相关元数据。
- 支持从单词笔记嵌入受管理的 reference 笔记。
- 渲染语义化 `eudic-block` 区块，用于预览和最终同步输出。
- 提供同步、元数据修复、标记格式化、reference 提取等命令。
- 可选显示笔记标题栏同步按钮和状态栏同步入口。

## 使用前准备

1. 在 Obsidian 中安装插件。
2. 打开 Eudic Sync 设置页。
3. 设置单词笔记文件夹和 reference 笔记文件夹。
4. 填入欧路词典 Authorization token。
5. 先用一个单词笔记测试，再批量同步更多笔记。

默认文件夹示例：

- `Eudic/Words`
- `Eudic/References`

## 常用命令

- `Sync current word`
- `Sync all dirty words`
- `Refresh Eudic studylists`
- `Pull studylist assignments from Eudic`
- `Push all dirty studylist assignments to Eudic`
- `Rebuild reference graph`
- `Repair All reference metadata`
- `Format current Eudic note bold markers`
- `Create reference from selection`
- `Extract current Eudic block to reference`
- `Wrap selection as Eudic block`
- `Insert Eudic block`

## 通过 BRAT 安装

1. 在 Obsidian 社区插件中安装 [BRAT](https://github.com/TfTHacker/obsidian42-brat)。
2. 启用 BRAT。
3. 在 BRAT 中选择添加 beta 插件。
4. 粘贴本仓库地址：

   `https://github.com/TheodorePeng/obsidian-eudic-sync-peng`

5. 确认安装，然后在 Obsidian 中启用 Eudic Sync。

## 通过 BRAT 更新

1. 新版本通过 GitHub Releases 发布。
2. Release tag 与 `manifest.json` 中的插件版本保持一致。
3. BRAT 会下载 release assets 中的插件文件。
4. 更新后如有需要，重新加载 Obsidian。

## 环境要求

- Obsidian 1.7.7 或更高版本
- 欧路词典账号和 Eudic Authorization token
- 能够访问欧路词典 API 的网络环境

## 隐私与本地数据

- Eudic Authorization token 由 Obsidian 保存在本地插件设置文件中，通常是 `data.json`。
- `data.json` 已被 Git 忽略，不应该提交或发布。
- 导出的设置备份可能包含 Eudic Authorization token，请按敏感文件保管。
- 当你运行同步相关命令时，插件会将选定的受管理笔记内容和生词本操作发送到欧路词典。

## 仓库结构

- `src/` 存放 TypeScript 源码。
- `main.js` 是 Obsidian 和 BRAT release 使用的打包入口文件。
- `styles.css` 存放插件样式。
- `manifest.json` 和 `versions.json` 用于 Obsidian 和 BRAT 发布。
- `tests/` 存放本地单元测试和行为测试。
- `data.json` 是本地设置数据，不应提交到 Git。
- `eudic-sync-original-base.zip` 是本插件的原始基础版本压缩包。如果项目需要从头重建，可以将其作为恢复起点。
