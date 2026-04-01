# Booking Log v1.0 — Deploy to Render (Free)

## 部署步驟 / Deployment Steps

### 1. 準備工作 / Preparation

**你需要 / You'll need:**
- GitHub 帳號（免費）
- Render 帳號（免費，https://render.com）

**代碼位置 / Code location:**
```
/home/framan/.openclaw/workspace/booking-log/
```

### 2. 創建 GitHub Repository

1. 去 https://github.com/new
2. Repository name: `booking-log`
3. Make it **Public**
4. 不要初始化，skip README

**或者用 Command Line 創建：**
```bash
cd /home/framan/.openclaw/workspace/booking-log
git init
git add .
git commit -m "Booking Log v1.0"
gh repo create booking-log --public --source=. --push
```

### 3. 部署去 Render

1. 登入 https://render.com
2. Click **"New +"** → **"Blueprint"**
3. Connect your GitHub repo (`booking-log`)
4. Render 會自動偵測 `render.yaml`
5. 點 **"Apply"**

Render 會自動：
- 安裝 `npm install`
- 啟動 server（Port 3000）
- 給你一個 subdomain：`https://booking-log.onrender.com`

### 4. 完成！

訪問你嘅 subdomain，你应该能看到 Booking Log 登入頁面。

**Admin 登入：**
- Email: `admin@bookinglog.com`
- Password: `admin123`

---

## 重要 Note

Render 免費版：
- 閒置 15 分鐘後會休眠
- 每月最多 750 小時（夠用）
- 數據會保存在 SQLite 檔案（`booking.db`）

如果Render休眠後數據仍在，但若帳號被刪除/重建則數據會丢失。

---

## 試完滿意後

如果你想有持久化數據庫 + 自定義 domain + 去除休眠限制，我可以幫你升级方案。
