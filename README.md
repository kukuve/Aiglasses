# AiGlasses — Smart AI Glasses System

An end-to-end smart glasses solution that combines ESP32-CAM hardware with a WeChat mini program ecosystem. Users capture images through wearable camera hardware, which are uploaded to the cloud, analyzed by multi-provider AI vision models (DeepSeek, GPT-4 Vision, Gemini, Qwen, or custom), and returned as structured object recognition results with vocabulary words for language learning.

> **⚠️ SECURITY NOTICE**  
> This README contains placeholder values (e.g., `your-cloud-environment-id`, `your-wechat-app-id`, `your-auth-hash-secret-here`) throughout all configuration examples and code snippets. **Never commit real credentials, API keys, environment IDs, AppIDs, or passwords to version control.** Before deploying, replace every placeholder with your own private values. See [Section 10 (Configuration & Environment Variables)](#10-configuration--environment-variables) for a complete checklist. All sensitive defaults found in the original source code have been sanitized — if you previously cloned or forked this repository, rotate any credentials that may have been exposed.

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Architecture](#2-architecture)
3. [Technology Stack](#3-technology-stack)
4. [Database Schema](#4-database-schema)
5. [Cloud Development Resources](#5-cloud-development-resources)
6. [Setup and Deployment](#6-setup-and-deployment)
7. [Component Interaction & Data Flow](#7-component-interaction--data-flow)
8. [Key Features](#8-key-features)
9. [Security Considerations](#9-security-considerations)
10. [Configuration & Environment Variables](#10-configuration--environment-variables)
11. [Deployment Workflow & Important Notes](#11-deployment-workflow--important-notes)

---

## 1. Project Overview

AiGlasses is a complete IoT + cloud + mobile system designed for smart glasses. An ESP32-CAM module mounted on glasses captures photos at the press of a button, uploads them via HTTPS to a WeChat Cloud Base backend. The backend invokes an AI vision model to recognize objects, scenes, and text in the image, then extracts English vocabulary words with phonetics, meanings, and example sentences. Results are pushed in real time to the user's WeChat mini program, where they can browse, review, and mark words as mastered.

**Main functionality:**

- Hardware-triggered JPEG image capture on ESP32-CAM (button press or serial command)
- Secure HTTPS upload with device identity verification
- Multi-provider AI vision analysis (DeepSeek, GPT-4 Vision, Gemini Pro, Qwen VL, or custom OpenAI-compatible endpoints)
- Automatic vocabulary extraction from recognized objects and scenes
- Real-time result delivery to the user's WeChat mini program
- Admin management dashboard for user analytics and super-admin sensitive data queries

---

## 2. Architecture

The project consists of three main components:

```
┌─────────────────────────────┐      HTTPS POST       ┌──────────────────────────────┐
│   SmartGlasses_MVP          │ ────────────────────── │   admin/cloudfunctions/      │
│   (ESP32-CAM Firmware)      │   image/jpeg binary    │   uploadImage (HTTP trigger) │
│                             │   + X-Device-ID header │                              │
│   - Camera capture          │                        │   - Verify device binding    │
│   - Button/Serial trigger   │                        │   - Upload to cloud storage  │
│   - WiFi station            │                        │   - Call AI Vision API       │
│   - HTTP server (port 80)   │                        │   - Extract vocabulary       │
└─────────────────────────────┘                        │   - Write results to DB      │
                                                       └──────────┬───────────────────┘
                                                                  │
┌─────────────────────────────┐                                   │
│   User_UI                   │      wx.cloud.callFunction        │
│   (WeChat Mini Program)     │ ◄──────────────────────────────── │
│                             │                                   │
│   - Register / Login        │    ┌─────────────────────────────┤
│   - Device Binding          │    │  userAuth (auth + users)     │
│   - AI Results (real-time)  │    │  bindDevice (device binding) │
│   - Vocabulary Learning     │    │  saveApiConfig (API keys)    │
│   - API Key Configuration   │    │  vocabApi (vocabulary CRUD)  │
└─────────────────────────────┘    └─────────────────────────────┘

┌─────────────────────────────┐
│   admin/miniprogram         │      wx.cloud.callFunction
│   (Management Backend)      │ ◄────────────────────────────────
│                             │
│   - Dashboard (user stats)  │    ┌─────────────────────────────┐
│   - Super Admin (sensitive) │    │  userAuth (listUsers,       │
│                             │    │  userStats, getUserSensitive)│
└─────────────────────────────┘    └─────────────────────────────┘
```

### Component Details

**SmartGlasses_MVP** — ESP32-CAM firmware built with PlatformIO and ESP-IDF framework. Initializes the OV2640/OV3660 camera sensor, connects to WiFi, and provides two capture modes: physical button (GPIO13) and serial terminal command (`p`/`P`). Captured JPEG frames are uploaded via HTTPS POST to the `uploadImage` cloud function. Also runs a lightweight HTTP server on port 80 for browser-based live capture at `http://<device-ip>/`.

**User_UI** — WeChat Mini Program for end users. Handles phone-based registration/login with SMS verification codes, device binding via manual input or QR code scan, real-time viewing of AI recognition results (using database watchers), vocabulary word list browsing with mastered/learning status tracking, and configuration of personal AI provider API keys.

**admin** — WeChat Cloud Development project containing all cloud functions and a management mini program. Cloud functions implement authentication, device binding, image upload/processing, vocabulary management, and API key storage. The management mini program provides a user analytics dashboard with statistics (total users, active users, today/week logins) and a super-admin page for querying sensitive user data (with admin key authentication).

---

## 3. Technology Stack

### SmartGlasses_MVP (ESP32 Firmware)

| Technology | Purpose |
|---|---|
| PlatformIO | Build system and dependency management |
| ESP-IDF (Espressif IoT Development Framework) | Core SDK for ESP32 |
| FreeRTOS | Real-time operating system (tasks, queues, semaphores, event groups) |
| esp32-camera component | Camera driver for OV2640/OV3660 sensors |
| esp_http_client | HTTPS client with certificate bundle for cloud upload |
| esp_http_server | Lightweight HTTP server for browser-based capture |
| C (C99) | Implementation language |

### User_UI (WeChat Mini Program Frontend)

| Technology | Purpose |
|---|---|
| WeChat Mini Program Framework | Runtime and APIs (wx.*) |
| WXML | Markup language for page structure |
| WXSS | Styling (CSS-like) |
| JavaScript (ES6) | Page logic and utilities |
| wx.cloud | WeChat Cloud Base SDK (database, cloud functions, storage) |
| WeChat Base Library 2.2.3+ | Minimum required version |

### admin (Cloud Functions & Management Backend)

| Technology | Purpose |
|---|---|
| Node.js | Cloud function runtime |
| wx-server-sdk (~2.4.0) | Server-side WeChat Cloud SDK |
| crypto (Node.js built-in) | SHA-256 hashing, AES-256-CBC encryption |
| node-fetch (v2) | HTTP client for calling external AI APIs |
| WeChat Cloud Base | Serverless database (JSON document store), file storage, cloud functions |
| WXML / WXSS / JS | Management mini program UI |

---

## 4. Database Schema

All collections reside in WeChat Cloud Base (environment: `your-cloud-environment-id`). Documents use auto-generated `_id` values unless otherwise noted.

### 4.1 `users` — User Accounts

Core user identity and authentication data.

| Field | Type | Description |
|---|---|---|
| `_id` | string (auto) | Unique user ID |
| `account` | string | Login account (phone number) |
| `accountId` | string | Immutable account identifier (`acc_` + random hex) |
| `phone` | string | Normalized phone number (e.g., `+8613800138000`) |
| `phoneHash` | string | SHA-256 hash of phone for privacy-preserving lookups |
| `phoneMasked` | string | Masked phone for display (e.g., `+861****000`) |
| `passwordHash` | string | SHA-256(password + salt + secret) |
| `passwordSalt` | string | Random 8-byte hex salt |
| `passwordRawEncrypted` | string | AES-256-CBC encrypted plaintext password (admin recovery) |
| `passwordRawUpdatedAtMs` | number | Timestamp of last password raw encryption update |
| `sessionToken` | string | Current session token (24 hex chars) |
| `sessionExpiresAt` | number | Session expiry timestamp (ms, 7 days from issue) |
| `status` | string | `active` (default) |
| `loginCount` | number | Total successful login count |
| `lastLoginAt` | serverDate | Last login timestamp |
| `lastLoginAtMs` | number | Last login timestamp in milliseconds |
| `createdAt` | serverDate | Account creation timestamp |
| `createdAtMs` | number | Creation timestamp in milliseconds |
| `updatedAt` | serverDate | Last update timestamp |
| `openid` | string | WeChat OpenID for the user |

### 4.2 `auth_codes` — Verification Codes

Temporary, one-time-use SMS verification codes for registration and account recovery.

| Field | Type | Description |
|---|---|---|
| `_id` | string (auto) | Unique record ID |
| `phoneHash` | string | SHA-256 hash of target phone |
| `phoneMasked` | string | Masked phone for audit |
| `code` | string | 6-digit verification code |
| `used` | boolean | Whether the code has been consumed |
| `usedAt` | serverDate | When the code was used |
| `expiresAt` | number | Expiry timestamp (5 minutes from creation) |
| `createdAt` | serverDate | Creation timestamp |
| `createdAtMs` | number | Creation timestamp in ms |

### 4.3 `device_bindings` — Device-to-User Binding

Links ESP32-CAM hardware devices to user accounts.

| Field | Type | Description |
|---|---|---|
| `_id` | string (auto) | Unique binding ID |
| `device_id` | string | ESP32 MAC-based device identifier (12 hex chars) |
| `user_id` | string | Bound user's `_id` from `users` |
| `user_phone` | string | Bound user's phone number |
| `bind_time` | serverDate | Binding timestamp |
| `bind_time_ms` | number | Binding timestamp in ms |
| `created_at` | serverDate | Record creation |
| `updated_at` | serverDate | Last update |

**Indexes:** Unique on `device_id`, plus non-unique indexes on `device_id`, `user_id`, `user_phone`.

### 4.4 `phone_bindings` — Immutable Phone-to-Account Binding

Enforces one-to-one phone-to-account mapping. Uses `phoneHash` as the document `_id` for natural uniqueness.

| Field | Type | Description |
|---|---|---|
| `_id` | string | Phone hash (SHA-256, used as doc ID) |
| `userId` | string | Bound user's `_id` |
| `accountId` | string | User's immutable account ID |
| `phoneMasked` | string | Masked phone for display |
| `createdAt` | serverDate | Creation timestamp |
| `createdAtMs` | number | Creation timestamp in ms |

### 4.5 `binding_audit_logs` — Phone Binding Audit Trail

Records all phone binding operations for security auditing.

| Field | Type | Description |
|---|---|---|
| `_id` | string (auto) | Unique log ID |
| `action` | string | Action type (e.g., `auto_bind_success`, `auto_bind_conflict`, `register_bind`) |
| `payload` | object | Action-specific metadata |
| `createdAt` | serverDate | Log creation timestamp |
| `createdAtMs` | number | Timestamp in ms |

### 4.6 `device_binding_logs` — Device Binding Audit Trail

Records all device binding attempts (success and failure).

| Field | Type | Description |
|---|---|---|
| `_id` | string (auto) | Unique log ID |
| `device_id` | string | Device identifier |
| `user_id` | string | User ID (if authenticated) |
| `user_phone` | string | Phone (if available) |
| `result` | string | Outcome (e.g., `bound`, `already_bound_same_user`, `already_bound_different_user`) |
| `case` | string | Binding case (e.g., `new_binding`, `idempotent_success`, `conflict`) |
| `error` | string | Error message if failed |
| `created_at` | serverDate | Log creation |
| `created_at_ms` | number | Timestamp in ms |

### 4.7 `device_upload_logs` — Image Upload Audit Trail

Records every image upload attempt from ESP32 devices.

| Field | Type | Description |
|---|---|---|
| `_id` | string (auto) | Unique log ID |
| `device_id` | string | Device identifier |
| `user_phone` | string | Bound user's phone (if device is bound) |
| `result` | string | Outcome (`success`, `device_not_bound`, `no_api_key`, `error`) |
| `content_type` | string | Request Content-Type header |
| `bytes` | number | Uploaded image size in bytes |
| `file_id` | string | Cloud storage file ID (if successful) |
| `ai_model` | string | AI model used for processing |
| `devices_record_id` | string | Reference to `devices` collection record |
| `error` | string | Error message (if failed) |
| `request_time` | serverDate | Upload timestamp |
| `request_time_ms` | number | Timestamp in ms |

### 4.8 `devices` — AI Processing Results

Stores processed image metadata and AI vision analysis results.

| Field | Type | Description |
|---|---|---|
| `_id` | string (auto) | Unique record ID |
| `device_id` | string | Source device identifier |
| `user_phone` | string | Bound user's phone |
| `file_id` | string | Cloud storage file ID for the uploaded image |
| `image_url` | string | Temporary URL for image access |
| `ai_result` | object | Structured AI result: `{ objects, scene, description, tags, confidence, words }` |
| `ai_model` | string | AI model/provider used (e.g., `deepseek`, `gpt4v`, `gemini`) |
| `upload_time` | serverDate | Processing timestamp |
| `upload_time_ms` | number | Timestamp in ms |
| `image_size` | number | Image size in bytes |
| `status` | string | `completed` on success |

### 4.9 `user_api_configs` — User AI Provider API Keys

User-configured API keys for their preferred AI vision providers.

| Field | Type | Description |
|---|---|---|
| `_id` | string (auto) | Unique record ID |
| `user_id` | string | User's `_id` |
| `user_phone` | string | User's phone (for backward-compatible lookup) |
| `selected_provider` | string | Currently active provider (`deepseek`, `gpt4v`, `gemini`, `qwen`, `custom`) |
| `providers` | object | Per-provider config: `{ providerName: { api_key, model_id, configured_at, endpoint?, model_name? } }` |
| `created_at` | serverDate | Creation timestamp |
| `created_at_ms` | number | Timestamp in ms |
| `updated_at` | serverDate | Last update |
| `updated_at_ms` | number | Timestamp in ms |

### 4.10 `vocabulary` — Extracted Learning Words

English vocabulary words extracted from AI image analysis.

| Field | Type | Description |
|---|---|---|
| `_id` | string (auto) | Unique word record ID |
| `word` | string | English word |
| `phonetic` | string | Pronunciation (IPA or simplified) |
| `meaning` | string | Chinese definition |
| `sentence` | string | Example sentence using the word |
| `status` | string | Learning status: `new`, `learning`, `mastered` |
| `review_count` | number | Times reviewed/marked |
| `user_phone` | string | Owner's phone for data isolation |
| `source_device_id` | string | Device that captured the source image |
| `source_image_id` | string | Reference to `devices` record |
| `created_at` | serverDate | Creation timestamp |
| `created_at_ms` | number | Timestamp in ms |

---

## 5. Cloud Development Resources

### WeChat Cloud Base Environment

- **Environment ID**: `your-cloud-environment-id`
- **Database**: JSON document store with 10 collections (see Section 4)
- **File Storage**: Stores uploaded JPEG images under `device-uploads/YYYYMMDD/<device_id>/` path
- **Cloud Functions**: 6 deployed functions (see below)

### Cloud Functions

| Function | Type | Purpose |
|---|---|---|
| `userAuth` | Callable | Registration, login, session verification, logout, user listing, user statistics, sensitive data queries, phone code sending, account retrieval |
| `bindDevice` | Callable | Device-to-user binding with session validation and phone binding verification |
| `uploadImage` | HTTP Trigger (POST) | Receives JPEG from ESP32, verifies device binding, uploads to storage, calls AI vision API, extracts vocabulary |
| `initDeviceBindings` | Callable | One-time initialization of `device_bindings` collection and indexes |
| `saveApiConfig` | Callable | Save, retrieve, delete, and test user AI provider API key configurations |
| `vocabApi` | Callable | List vocabulary words with pagination, get learning statistics, update word status |

### External AI Services

The `uploadImage` cloud function supports calling the following AI vision APIs, configurable per user:

- **DeepSeek** — `https://api.deepseek.com/v1/chat/completions` (model: `deepseek-chat`)
- **GPT-4 Vision (OpenAI)** — `https://api.openai.com/v1/chat/completions` (model: `gpt-4o`)
- **Gemini Pro (Google)** — `https://generativelanguage.googleapis.com/v1beta/models/` (model: `gemini-2.0-flash`)
- **Qwen VL (Alibaba)** — `https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions` (model: `qwen-vl-plus`)
- **Custom** — Any OpenAI-compatible API endpoint (user-provided URL, model name, and API key)

---

## 6. Setup and Deployment

### 6.1 Prerequisites

- **Hardware**: ESP32-CAM AI-Thinker module (with OV2640 or OV3660 camera), USB-to-Serial adapter
- **Software**: [PlatformIO IDE](https://platformio.org/) (VS Code extension) or PlatformIO Core CLI, [WeChat Developer Tools](https://developers.weixin.qq.com/miniprogram/dev/devtools/download.html)
- **Accounts**: WeChat Mini Program AppID (replace `your-wechat-app-id` with your own registered AppID), WeChat Cloud Base environment, AI provider API keys (DeepSeek, OpenAI, Google, or Alibaba)

### 6.2 SmartGlasses_MVP (ESP32 Firmware)

1. **Install PlatformIO** (VS Code extension recommended).

2. **Open the project**:
   ```bash
   cd SmartGlasses_MVP
   # Open in VS Code or PlatformIO IDE
   ```

3. **Configure WiFi credentials** in `platformio.ini` (⚠️ never commit real credentials):
   ```ini
   build_flags =
       -DCONFIG_WIFI_SSID=\"YourWiFiSSID\"
       -DCONFIG_WIFI_PASSWORD=\"YourWiFiPassword\"
   ```

4. **Set the upload URL** in `src/main.c` line 42 (⚠️ never commit the real URL):
   ```c
   #define UPLOAD_URL "https://your-cloud-environment-id.service.tcloudbase.com/uploadImage"
   ```
   Replace `your-cloud-environment-id` with your actual Cloud Base environment ID. Get the exact HTTP trigger URL from your deployed `uploadImage` cloud function.

5. **Configure upload port** in `platformio.ini` (⚠️ never commit your real port):
   ```ini
   upload_port = /dev/cu.usbserial-XXXX      # macOS (replace with your port)
   monitor_port = /dev/cu.usbserial-XXXX     # macOS (replace with your port)
   ```
   Adjust for your OS (e.g., `COM3` on Windows, `/dev/ttyUSB0` on Linux).

6. **Build and flash**:
   ```bash
   pio run --target upload
   ```

7. **Monitor serial output**:
   ```bash
   pio device monitor
   ```

8. **Verify**: After boot, the serial monitor shows WiFi connection and IP address. Open `http://<device-ip>/` in a browser to verify the camera works.

### 6.3 User_UI (WeChat Mini Program)

1. **Open WeChat Developer Tools**.

2. **Import project**: Select the `User_UI/` directory.

3. **Set AppID**: Use `your-wechat-app-id` or your own registered AppID.

4. **Cloud environment** is already configured in `app.js`:
   ```javascript
   env: 'your-cloud-environment-id'
   ```

5. **Ensure cloud functions are deployed** (see Section 6.4) before testing.

6. **Preview**: Click "Preview" to test on mobile, or use the built-in simulator.

### 6.4 admin (Cloud Functions & Management Backend)

#### Cloud Function Deployment

1. **Open WeChat Developer Tools**, import the `admin/` directory.

2. **Deploy each cloud function** by right-clicking the function folder in the cloud functions panel and selecting "Upload and Deploy: Install Dependencies":

   Deploy in this order:
   - `initDeviceBindings`
   - `userAuth`
   - `bindDevice`
   - `uploadImage` (must also configure HTTP trigger after deployment)
   - `saveApiConfig`
   - `vocabApi`

3. **Configure HTTP trigger for `uploadImage`**:
   - In WeChat Cloud Base Console, navigate to Cloud Functions → `uploadImage`
   - Add an HTTP trigger, method: **POST only**
   - Copy the resulting trigger URL and update `UPLOAD_URL` in `SmartGlasses_MVP/src/main.c`

4. **Initialize database** by calling the init function once:
   ```javascript
   wx.cloud.callFunction({ name: 'initDeviceBindings' })
   ```
   This creates the `device_bindings` collection and required indexes. If index creation is restricted by cloud policy, manually create them in the CloudBase console.

5. **Import device master data** into the `devices` collection (optional, for device existence validation in `bindDevice`):
   ```json
   {
     "device_id": "A1B2C3D4E5F6",
     "model": "AIGlass-MVP",
     "status": "ready"
   }
   ```

6. **Set environment variables** for cloud functions (see Section 10).

---

## 7. Component Interaction & Data Flow

### Image Capture & Processing Pipeline

```
   ESP32-CAM                   Cloud Functions                    WeChat Mini Program
   ─────────                   ───────────────                    ──────────────────

1. Button press
   (GPIO13 interrupt)
         │
2. esp_camera_fb_get()
   Capture JPEG frame
   (SVGA 800×600)
         │
3. HTTPS POST ────────────►  uploadImage (HTTP trigger)
   binary image/jpeg           │
   Header: X-Device-ID         ├─ 4. Verify device_bindings
                               │    (check device is bound)
                               │
                               ├─ 5. cloud.uploadFile()
                               │    Store JPEG in cloud storage
                               │
                               ├─ 6. Get user's API config
                               │    from user_api_configs
                               │
                               ├─ 7. Call AI Vision API
                               │    (DeepSeek/GPT-4V/Gemini/Qwen/Custom)
                               │    Send image as base64
                               │
                               ├─ 8. Parse AI JSON response
                               │    { objects, scene, description,
                               │      tags, confidence, words }
                               │
                               ├─ 9. Write to devices collection
                               │
                               ├─ 10. Extract vocabulary words
                               │     Write to vocabulary collection
                               │
                               └─ 11. Return 200 ────────────►
                                                              12. Database watcher
                                                                 detects new record
                                                                 in devices collection
                                                                       │
                                                              13. Show popup with
                                                                 AI results
                                                                       │
                                                              14. User browses
                                                                 vocabulary words
                                                                 and marks mastery
```

### Authentication Flow

```
   User_UI Mini Program                    userAuth Cloud Function
   ────────────────────                    ──────────────────────

   Register:
   phone + code + password  ──────────►  verifyCode(phone, code)
                                        create user in users collection
                                        autoBindPhoneForUser (phone_bindings)
                                        return sessionToken

   Login:
   account + password       ──────────►  findUserByAccount (phone or accountId)
                                        hashPassword + compare
                                        autoBindPhoneForUser (login-time bind)
                                        update sessionToken, loginCount
                                        encrypt password with AES-256-CBC
                                        return sessionToken

   Session Restore:
   sessionToken             ──────────►  verifySession
   (stored in wx.storage)               check users collection
                                        validate expiry
                                        return userInfo
```

### Device Binding Flow

```
   User_UI (device-bind page)            bindDevice Cloud Function
   ──────────────────────────            ────────────────────────

   sessionToken + Device_ID  ──────────► getLoginUser (validate session)
                                         verify phone binding exists
                                         check device_bindings:
                                           Case 1: Not bound → create binding
                                           Case 2: Same user → idempotent success
                                           Case 3: Different user → 409 conflict
                                         write device_binding_logs
```

---

## 8. Key Features

### 8.1 User Registration & Login

- Phone number registration with 6-digit SMS verification code
- International phone number support (normalized to `+<country_code><number>` format, Chinese mainland numbers auto-prefixed with `+86`)
- Password strength meter during registration
- SHA-256 password hashing with per-user random salt
- 7-day session token with automatic expiry
- "Remember me" account persistence
- Account retrieval by phone with verification code

### 8.2 Device Binding

- Manual Device ID entry (8-32 character alphanumeric code)
- QR code scan for auto-filling Device ID
- Three-case binding logic: new binding, idempotent re-binding (same user), conflict rejection (different user)
- Requirement: phone must be bound to account before device binding
- Idempotent: re-binding the same device to the same user succeeds gracefully with "already bound" confirmation
- Persists bound device info to local storage and globalData for display across pages

### 8.3 Image Capture & Upload

- **Physical button**: Press button on GPIO13 to trigger capture + upload
- **Serial command**: Type `p` or `P` in serial monitor (115200 baud)
- **Browser capture**: Visit `http://<device-ip>/` or `http://<device-ip>/capture.jpg` for live JPEG stream
- Retry logic: up to 3 retries with exponential backoff (2s, 4s, 6s intervals)
- 35-second HTTP timeout for large image uploads
- Mutex-protected camera access prevents concurrent capture conflicts

### 8.4 AI Vision Processing

- **Multi-provider support**: DeepSeek, GPT-4 Vision, Gemini Pro, Qwen VL, and custom OpenAI-compatible endpoints
- **Per-user API key configuration**: Each user can bring their own API keys
- **Vision prompt**: Structured JSON output with objects, scene description, tags, confidence level, and vocabulary words
- **Vocabulary extraction**: 3-10 English words per image with phonetics, Chinese meanings, and example sentences
- **Provider fallback**: Falls back to default DeepSeek if user hasn't configured any provider
- **API key testing**: Users can validate their API keys before saving through the mini program

### 8.5 Vocabulary Learning

- Words extracted from AI processing are stored in the `vocabulary` collection
- Three learning statuses: `new`, `learning`, `mastered`
- Paginated word list with pull-down refresh and scroll-to-load-more
- Learning statistics dashboard: total words, mastered count, today's count
- One-tap "mark as mastered" with review count increment
- Words linked to source device and image for traceability

### 8.6 Real-Time AI Results

- Database watcher on `devices` collection detects new records in real time
- Popup notification when a new AI result arrives
- Historical results list with pagination
- Image preview with zoom
- AI model attribution showing which provider processed each image
- Timestamp display in localized format

### 8.7 Admin Dashboard

- User statistics: total users, active users, today's logins, 7-day logins
- User table with pagination and status filtering
- Display fields: account, phone (masked), status, login count, creation time, last login, OpenID
- Timeout-resilient data loading with `Promise.allSettled` and degradable display
- Direct navigation to super-admin sensitive query for any user

### 8.8 Super Admin

- Protected by `SUPER_ADMIN_KEY` environment variable
- Query sensitive user data by User ID or phone number
- View decrypted plaintext passwords (AES-256-CBC decryption)
- Supports historical phone number formats (backward compatible phone lookup)
- Auto-fill User ID when navigating from dashboard user card
- All sensitive queries are audit-logged to `binding_audit_logs`

---

## 9. Security Considerations

### 9.1 Authentication

- **Password Storage**: Passwords are hashed using SHA-256 with the formula `SHA-256(password + randomSalt + AUTH_HASH_SECRET)` — never stored in plaintext.
- **Password Recovery**: Plaintext passwords are encrypted with AES-256-CBC using a separate `PASSWORD_ENCRYPT_SECRET` key for super-admin access only.
- **Session Management**: Session tokens are 24-character hex random strings with a 7-day TTL. Tokens are invalidated on logout and validated on every authenticated request.
- **Login Tracking**: Login count, last login timestamp, and session expiry are updated on every successful login.

### 9.2 Phone Number Privacy

- Phone numbers stored in the `users` collection use SHA-256 hashing (`phoneHash`) as the primary lookup key.
- `phone_bindings` collection uses the hash as document `_id` for natural uniqueness.
- Admin dashboard displays only masked phone numbers (`phoneMasked`, e.g., `+861****000`).
- Phone number queries are normalized through `getPhoneQueryCandidates` to support multiple historical formats.

### 9.3 Device Security

- Device identity is derived from the ESP32's WiFi MAC address (12 hex characters).
- Image uploads are rejected (HTTP 403) if the device is not bound to any user in `device_bindings`.
- Device binding requires: valid user session, phone-to-account binding verification, and uniqueness enforcement.
- Binding conflicts (device already bound to a different user) are logged and rejected with HTTP 409.

### 9.4 API Key Protection

- User API keys stored in `user_api_configs` are only accessible to the owning user (via session validation).
- When retrieved for display, API keys are masked (e.g., `****a1b2` showing only last 4 characters).
- API key test endpoint (`saveApiConfig.testKey`) does not require session authentication but only performs validation — keys are never exposed in responses.
- API keys are validated with length constraints (10-256 characters for keys, 128 max for model IDs).

### 9.5 Audit Logging

- **`binding_audit_logs`**: Records all phone binding operations (auto-bind success/failure, admin sensitive queries, account retrieval).
- **`device_binding_logs`**: Records all device binding attempts with outcome and case classification.
- **`device_upload_logs`**: Records every image upload attempt (success and failure) with device ID, result, and AI model used.
- Super admin sensitive queries are logged with userId, accountId, and whether plaintext password was available.

### 9.6 Admin Access Control

- Super admin functionality requires matching `SUPER_ADMIN_KEY` environment variable.
- A default value is present in code (`your-super-admin-key-here`) but **must be overridden** in production via environment variable.
- If `SUPER_ADMIN_KEY` is not configured, all sensitive queries are rejected.

---

## 10. Configuration & Environment Variables

### 10.1 SmartGlasses_MVP (ESP32 Firmware)

Configured via `platformio.ini` build flags:

| Variable | Default | Description |
|---|---|---|
| `CONFIG_WIFI_SSID` | `YourWiFiSSID` | WiFi network name |
| `CONFIG_WIFI_PASSWORD` | `YourWiFiPassword` | WiFi password |

Configured via `#define` in `src/main.c`:

| Constant | Line | Description |
|---|---|---|
| `UPLOAD_URL` | 42 | HTTPS endpoint for image upload |
| `BUTTON_GPIO` | 49 | GPIO pin for capture button (default: 13) |
| `MAX_RETRY` | 43 | Max upload retry attempts (default: 3) |
| `HTTP_TIMEOUT_MS` | 44 | Upload HTTP timeout (default: 35000ms) |

### 10.2 Cloud Functions (Environment Variables)

> **🔒 CRITICAL: All default values shown below are PLACEHOLDERS for documentation only.** You MUST override every variable with your own strong, unique secrets before deploying to production. Never use the placeholder values in a live environment — they are not secrets and offer zero security.

Set these in WeChat Cloud Base Console → Cloud Functions → Select function → Environment Variables:

| Variable | Used By | Default | Description |
|---|---|---|---|
| `AUTH_HASH_SECRET` | `userAuth` | `your-auth-hash-secret-here` | Secret key for password hashing and phone hashing |
| `PASSWORD_ENCRYPT_SECRET` | `userAuth` | `<your-auth-hash-secret-here>_Password_Encrypt` | AES-256-CBC encryption key for password storage |
| `SUPER_ADMIN_KEY` | `userAuth` | `your-super-admin-key-here` | Admin key for sensitive data access (MUST override in production) |
| `EXPOSE_VERIFY_CODE` | `userAuth` | `true` | Whether to expose verification codes in API responses (development only) |
| `DEEPSEEK_API_KEY` | `uploadImage` | (none) | Default DeepSeek API key for AI vision (used when user hasn't configured their own) |

### 10.3 WeChat Cloud Environment

> **📋 Note:** The Environment ID and AppID below are placeholders. Replace them with your own values obtained from the WeChat Mini Program admin console and Cloud Base console.

| Parameter | Value |
|---|---|
| Environment ID | `your-cloud-environment-id` |
| Mini Program AppID | `your-wechat-app-id` |

### 10.4 WeChat Developer Tools

- **Base library version**: 2.2.3 minimum (3.15.2 configured in admin/project.config.json)
- **ES6→ES5**: Enabled
- **Minification**: Enabled for WXML and WXSS
- **Cloud function root**: `cloudfunctions/`
- **Mini program root**: `miniprogram/`

---

## 11. Deployment Workflow & Important Notes

### 11.1 Full Deployment Order

For a complete fresh deployment, follow this order:

1. **Set up WeChat Cloud Base environment** in WeChat Developer Tools.

2. **Deploy cloud functions** (right-click each folder, upload and deploy):
   - `initDeviceBindings` → `userAuth` → `bindDevice` → `uploadImage` → `saveApiConfig` → `vocabApi`

3. **Configure HTTP trigger** for `uploadImage` (POST only), copy the URL.

4. **Set environment variables** in CloudBase console for `userAuth` and `uploadImage`.

5. **Initialize database**: Call `wx.cloud.callFunction({ name: 'initDeviceBindings' })` to create collections and indexes.

6. **Import device master data** into the `devices` collection with factory device IDs.

7. **Update `UPLOAD_URL`** in `SmartGlasses_MVP/src/main.c` with the HTTP trigger URL.

8. **Configure WiFi credentials** in `SmartGlasses_MVP/platformio.ini`.

9. **Build and flash ESP32 firmware**:
   ```bash
   cd SmartGlasses_MVP
   pio run --target upload
   ```

10. **Open User_UI in WeChat Developer Tools**, verify cloud environment is correct, test registration/login flow.

11. **Open admin mini program**, verify dashboard loads user data from `userAuth`.

### 11.2 Important Notes from DEVICE_BINDING_DEPLOY.md

- The `uploadImage` cloud function MUST be configured as an HTTP trigger with POST method only. Without this, the ESP32 cannot upload images.
- After deploying cloud functions, call `initDeviceBindings` once to initialize indexes. If index creation fails due to cloud policy, manually add indexes in CloudBase console:
  - `device_id` unique index (prevents duplicate bindings)
  - `device_id` non-unique index
  - `user_phone` non-unique index
- Device master data must be pre-loaded into the `devices` collection for the `bindDevice` function's device existence validation.
- The `UPLOAD_URL` in `main.c` must match the deployed `uploadImage` HTTP trigger URL exactly.

### 11.3 Important Notes from Troubleshooting Document

- **Admin dashboard data source**: The management dashboard in `admin/miniprogram/pages/dashboard/` queries `userAuth` (not `vocabApi`). Ensure the dashboard page is properly connected to the user authentication cloud function.
- **Phone binding is required for device binding**: Users must have completed phone binding (automatic on login/register) before they can bind a device. If binding fails with "phone not bound", the user should log out and log back in.
- **Historical phone format compatibility**: The system supports multiple phone number formats through `getPhoneQueryCandidates`, which generates both hash-based and plaintext candidates for backward compatibility with pre-migration user data.
- **Password recovery for super admin**: If `passwordRawEncrypted` is empty for a historical user, that user must log in once after the fix is deployed for the plaintext password to become available via the super admin panel.
- **Timeout resilience**: The admin dashboard uses `Promise.allSettled` and `callCloudSafe` with 7-second timeouts. If one request times out, the page degrades gracefully rather than failing entirely.

### 11.4 Common Troubleshooting

| Symptom | Likely Cause | Resolution |
|---|---|---|
| ESP32 upload fails with HTTP 403 | Device not bound in `device_bindings` | Bind the device via User_UI device-bind page |
| ESP32 upload fails with HTTP 500 "No AI API key" | No DEEPSEEK_API_KEY env var and no user API config | Set DEEPSEEK_API_KEY in cloud function env, or configure API key in the mini program |
| "云函数未部署" error in mini program | Cloud function not deployed or wrong environment | Deploy the cloud function in WeChat Developer Tools |
| Admin dashboard shows vocab data instead of users | Wrong data source | Ensure dashboard calls `userAuth` with `userStats` and `listUsers` actions |
| Device binding fails with "phone not bound" | Phone auto-bind didn't complete | Log out and log in again to trigger auto-bind, then retry binding |
| Super admin query returns "--" for password | Historical user, never logged in after fix | Have the user log in once, then query again |
| Camera init fails on ESP32 | Wrong board or camera module | Verify ESP32-CAM AI-Thinker pin configuration, check PSRAM enabled |

### 11.5 Production Hardening Checklist

> **⚠️ REMINDER:** All placeholder values in this README (e.g., `your-cloud-environment-id`, `your-wechat-app-id`, `your-auth-hash-secret-here`, `your-super-admin-key-here`, `YourWiFiSSID`, `YourWiFiPassword`) are for documentation only. Replace EVERY one of them with your own private values before deployment.

- [ ] Set strong, unique `SUPER_ADMIN_KEY` environment variable (never use the placeholder `your-super-admin-key-here`)
- [ ] Set strong, unique `AUTH_HASH_SECRET` environment variable
- [ ] Set strong, unique `PASSWORD_ENCRYPT_SECRET` environment variable
- [ ] Set `EXPOSE_VERIFY_CODE` to `false` (never expose verification codes in production)
- [ ] Configure real SMS service for verification codes (current implementation generates codes server-side but does not send SMS)
- [ ] Restrict `uploadImage` HTTP trigger to accept only from ESP32 IP ranges if possible
- [ ] Review and rotate all API keys regularly
- [ ] Set appropriate database permission rules in CloudBase console
- [ ] Enable cloud function logging and monitoring
- [ ] Back up database collections before major migrations
- [ ] Ensure `SmartGlasses_MVP/platformio.ini` and `SmartGlasses_MVP/src/main.c` are in `.gitignore` or use environment-specific files to avoid committing WiFi passwords and upload URLs
- [ ] Verify no real credentials, API keys, or environment IDs are present in any committed files before pushing to a public repository

---
---

# AiGlasses —— 智能AI眼镜系统（中文版）

一套端到端的智能眼镜解决方案，将 ESP32-CAM 硬件与微信小程序生态相结合。用户通过可穿戴摄像头硬件拍摄照片，照片通过 HTTPS 上传至云端，由多供应商 AI 视觉模型（DeepSeek、GPT-4 Vision、Gemini、Qwen 或自定义模型）进行分析，返回结构化的物体识别结果以及用于语言学习的词汇单词。

> **⚠️ 安全声明**  
> 本 README 中所有配置示例和代码片段均使用占位符（如 `your-cloud-environment-id`、`your-wechat-app-id`、`your-auth-hash-secret-here`）。**切勿将真实凭证、API 密钥、环境 ID、AppID 或密码提交至版本控制系统。** 部署前，请将所有占位符替换为您自己的私有值。详见[第 10 节（配置与环境变量）](#10-配置与环境变量)中的完整检查清单。原始源代码中的所有敏感默认值已被清除——如果您之前克隆或复刻过此仓库，请轮换所有可能已泄露的凭证。

---

## 目录

1. [项目概述](#1-项目概述)
2. [系统架构](#2-系统架构)
3. [技术栈](#3-技术栈)
4. [数据库模式](#4-数据库模式)
5. [云开发资源](#5-云开发资源)
6. [安装与部署](#6-安装与部署)
7. [组件交互与数据流](#7-组件交互与数据流)
8. [核心功能](#8-核心功能)
9. [安全考量](#9-安全考量)
10. [配置与环境变量](#10-配置与环境变量)
11. [部署工作流与重要说明](#11-部署工作流与重要说明)

---

## 1. 项目概述

AiGlasses 是一套为智能眼镜设计的完整 IoT + 云 + 移动端系统。安装在眼镜上的 ESP32-CAM 模块通过按键拍摄照片，通过 HTTPS 上传至微信云开发后端。后端调用 AI 视觉模型识别图像中的物体、场景和文字，然后提取英文词汇单词，附带音标、中文释义和例句。结果实时推送至用户的微信小程序，用户可浏览、复习并将单词标记为已掌握。

**主要功能：**

- 硬件触发的 ESP32-CAM JPEG 图像采集（按键或串口命令）
- 带设备身份验证的安全 HTTPS 上传
- 多供应商 AI 视觉分析（DeepSeek、GPT-4 Vision、Gemini Pro、Qwen VL 或自定义 OpenAI 兼容接口）
- 从识别到的物体和场景中自动提取词汇
- 实时结果推送至用户微信小程序
- 管理后台仪表盘（用户分析）及超级管理员敏感数据查询

---

## 2. 系统架构

项目由三个主要组件构成：

```
┌─────────────────────────────┐      HTTPS POST       ┌──────────────────────────────┐
│   SmartGlasses_MVP          │ ────────────────────── │   admin/cloudfunctions/      │
│   (ESP32-CAM 固件)          │   image/jpeg 二进制    │   uploadImage (HTTP 触发器)  │
│                             │   + X-Device-ID 请求头 │                              │
│   - 摄像头采集              │                        │   - 验证设备绑定             │
│   - 按键/串口触发           │                        │   - 上传至云存储             │
│   - WiFi 站点模式           │                        │   - 调用 AI 视觉 API         │
│   - HTTP 服务器 (80端口)    │                        │   - 提取词汇                 │
└─────────────────────────────┘                        │   - 写入数据库结果           │
                                                       └──────────┬───────────────────┘
                                                                  │
┌─────────────────────────────┐                                   │
│   User_UI                   │      wx.cloud.callFunction        │
│   (微信小程序)               │ ◄──────────────────────────────── │
│                             │                                   │
│   - 注册 / 登录             │    ┌─────────────────────────────┤
│   - 设备绑定                │    │  userAuth (认证 + 用户)      │
│   - AI 结果 (实时)          │    │  bindDevice (设备绑定)       │
│   - 词汇学习                │    │  saveApiConfig (API 密钥)    │
│   - API 密钥配置            │    │  vocabApi (词汇 CRUD)        │
└─────────────────────────────┘    └─────────────────────────────┘

┌─────────────────────────────┐
│   admin/miniprogram         │      wx.cloud.callFunction
│   (管理后台)                 │ ◄────────────────────────────────
│                             │
│   - 仪表盘 (用户统计)       │    ┌─────────────────────────────┐
│   - 超级管理 (敏感数据)     │    │  userAuth (listUsers,       │
│                             │    │  userStats, getUserSensitive)│
└─────────────────────────────┘    └─────────────────────────────┘
```

### 组件详情

**SmartGlasses_MVP** — 基于 PlatformIO 和 ESP-IDF 框架构建的 ESP32-CAM 固件。初始化 OV2640/OV3660 摄像头传感器，连接 WiFi，提供两种采集模式：物理按键（GPIO13）和串口终端命令（`p`/`P`）。采集到的 JPEG 帧通过 HTTPS POST 上传至 `uploadImage` 云函数。同时内建轻量 HTTP 服务器（端口 80），支持通过浏览器访问 `http://<device-ip>/` 实时查看画面。

**User_UI** — 面向终端用户的微信小程序。处理手机号注册/登录（短信验证码）、设备绑定（手动输入或扫码）、AI 识别结果实时查看（使用数据库监听器）、词汇列表浏览（含已掌握/学习中状态追踪）以及个人 AI 供应商 API 密钥配置。

**admin** — 微信云开发项目，包含所有云函数和一个管理小程序。云函数实现认证、设备绑定、图片上传/处理、词汇管理和 API 密钥存储。管理小程序提供用户分析仪表盘（统计总用户数、活跃用户、今日/本周登录）以及超级管理员页面（通过管理员密钥认证查询敏感用户数据）。

---

## 3. 技术栈

### SmartGlasses_MVP（ESP32 固件）

| 技术 | 用途 |
|---|---|
| PlatformIO | 构建系统和依赖管理 |
| ESP-IDF（乐鑫物联网开发框架） | ESP32 核心 SDK |
| FreeRTOS | 实时操作系统（任务、队列、信号量、事件组） |
| esp32-camera 组件 | OV2640/OV3660 传感器摄像头驱动 |
| esp_http_client | HTTPS 客户端，含证书捆绑包用于云端上传 |
| esp_http_server | 轻量 HTTP 服务器，用于浏览器端画面查看 |
| C（C99） | 实现语言 |

### User_UI（微信小程序前端）

| 技术 | 用途 |
|---|---|
| 微信小程序框架 | 运行时和 API（wx.*） |
| WXML | 页面结构标记语言 |
| WXSS | 样式（类 CSS） |
| JavaScript（ES6） | 页面逻辑和工具函数 |
| wx.cloud | 微信云开发 SDK（数据库、云函数、存储） |
| 微信基础库 2.2.3+ | 最低要求版本 |

### admin（云函数和管理后台）

| 技术 | 用途 |
|---|---|
| Node.js | 云函数运行时 |
| wx-server-sdk（~2.4.0） | 服务端微信云 SDK |
| crypto（Node.js 内置） | SHA-256 哈希、AES-256-CBC 加密 |
| node-fetch（v2） | 用于调用外部 AI API 的 HTTP 客户端 |
| 微信云开发 | 无服务器数据库（JSON 文档存储）、文件存储、云函数 |
| WXML / WXSS / JS | 管理小程序 UI |

---

## 4. 数据库模式

所有集合均位于微信云开发环境中（环境 ID：`your-cloud-environment-id`）。文档使用自动生成的 `_id` 值，除非另有说明。

### 4.1 `users` — 用户账户

核心用户身份和认证数据。

| 字段 | 类型 | 说明 |
|---|---|---|
| `_id` | string（自动） | 唯一用户 ID |
| `account` | string | 登录账号（手机号） |
| `accountId` | string | 不可变账户标识（`acc_` + 随机十六进制） |
| `phone` | string | 标准化手机号（例如 `+8613800138000`） |
| `phoneHash` | string | 手机号的 SHA-256 哈希（隐私保护查询） |
| `phoneMasked` | string | 脱敏手机号（例如 `+861****000`） |
| `passwordHash` | string | SHA-256(password + salt + secret) |
| `passwordSalt` | string | 随机 8 字节十六进制盐值 |
| `passwordRawEncrypted` | string | AES-256-CBC 加密的明文密码（管理员恢复用） |
| `passwordRawUpdatedAtMs` | number | 密码明文加密更新时间戳 |
| `sessionToken` | string | 当前会话令牌（24 个十六进制字符） |
| `sessionExpiresAt` | number | 会话过期时间戳（毫秒，签发后 7 天） |
| `status` | string | `active`（默认） |
| `loginCount` | number | 成功登录总次数 |
| `lastLoginAt` | serverDate | 最近登录时间戳 |
| `lastLoginAtMs` | number | 最近登录时间戳（毫秒） |
| `createdAt` | serverDate | 账户创建时间戳 |
| `createdAtMs` | number | 创建时间戳（毫秒） |
| `updatedAt` | serverDate | 最近更新时间戳 |
| `openid` | string | 用户微信 OpenID |

### 4.2 `auth_codes` — 验证码

用于注册和账户恢复的一次性短信验证码。

| 字段 | 类型 | 说明 |
|---|---|---|
| `_id` | string（自动） | 唯一记录 ID |
| `phoneHash` | string | 目标手机号的 SHA-256 哈希 |
| `phoneMasked` | string | 脱敏手机号（审计用） |
| `code` | string | 6 位验证码 |
| `used` | boolean | 是否已被使用 |
| `usedAt` | serverDate | 使用时间 |
| `expiresAt` | number | 过期时间戳（创建后 5 分钟） |
| `createdAt` | serverDate | 创建时间戳 |
| `createdAtMs` | number | 创建时间戳（毫秒） |

### 4.3 `device_bindings` — 设备与用户绑定

将 ESP32-CAM 硬件设备与用户账户关联。

| 字段 | 类型 | 说明 |
|---|---|---|
| `_id` | string（自动） | 唯一绑定 ID |
| `device_id` | string | 基于 ESP32 MAC 地址的设备标识（12 个十六进制字符） |
| `user_id` | string | 绑定用户在 `users` 中的 `_id` |
| `user_phone` | string | 绑定用户的手机号 |
| `bind_time` | serverDate | 绑定时间戳 |
| `bind_time_ms` | number | 绑定时间戳（毫秒） |
| `created_at` | serverDate | 记录创建时间 |
| `updated_at` | serverDate | 最近更新时间 |

**索引：** `device_id` 唯一索引，以及 `device_id`、`user_id`、`user_phone` 非唯一索引。

### 4.4 `phone_bindings` — 不可变手机号与账户绑定

强制手机号与账户一对一映射。使用 `phoneHash` 作为文档 `_id` 以实现天然唯一性。

| 字段 | 类型 | 说明 |
|---|---|---|
| `_id` | string | 手机号哈希（SHA-256，作为文档 ID） |
| `userId` | string | 绑定用户的 `_id` |
| `accountId` | string | 用户不可变账户 ID |
| `phoneMasked` | string | 脱敏手机号 |
| `createdAt` | serverDate | 创建时间戳 |
| `createdAtMs` | number | 创建时间戳（毫秒） |

### 4.5 `binding_audit_logs` — 手机号绑定审计追踪

记录所有手机号绑定操作，用于安全审计。

| 字段 | 类型 | 说明 |
|---|---|---|
| `_id` | string（自动） | 唯一日志 ID |
| `action` | string | 操作类型（如 `auto_bind_success`、`auto_bind_conflict`、`register_bind`） |
| `payload` | object | 操作相关元数据 |
| `createdAt` | serverDate | 日志创建时间戳 |
| `createdAtMs` | number | 时间戳（毫秒） |

### 4.6 `device_binding_logs` — 设备绑定审计追踪

记录所有设备绑定尝试（成功和失败）。

| 字段 | 类型 | 说明 |
|---|---|---|
| `_id` | string（自动） | 唯一日志 ID |
| `device_id` | string | 设备标识 |
| `user_id` | string | 用户 ID（如已认证） |
| `user_phone` | string | 手机号（如有） |
| `result` | string | 结果（如 `bound`、`already_bound_same_user`、`already_bound_different_user`） |
| `case` | string | 绑定场景（如 `new_binding`、`idempotent_success`、`conflict`） |
| `error` | string | 错误信息（如失败） |
| `created_at` | serverDate | 日志创建时间 |
| `created_at_ms` | number | 时间戳（毫秒） |

### 4.7 `device_upload_logs` — 图片上传审计追踪

记录来自 ESP32 设备的每次图片上传尝试。

| 字段 | 类型 | 说明 |
|---|---|---|
| `_id` | string（自动） | 唯一日志 ID |
| `device_id` | string | 设备标识 |
| `user_phone` | string | 绑定用户手机号（如设备已绑定） |
| `result` | string | 结果（`success`、`device_not_bound`、`no_api_key`、`error`） |
| `content_type` | string | 请求 Content-Type 头 |
| `bytes` | number | 上传图片大小（字节） |
| `file_id` | string | 云存储文件 ID（成功时） |
| `ai_model` | string | 用于处理的 AI 模型 |
| `devices_record_id` | string | 引用 `devices` 集合记录 |
| `error` | string | 错误信息（失败时） |
| `request_time` | serverDate | 上传时间戳 |
| `request_time_ms` | number | 时间戳（毫秒） |

### 4.8 `devices` — AI 处理结果

存储已处理图像元数据和 AI 视觉分析结果。

| 字段 | 类型 | 说明 |
|---|---|---|
| `_id` | string（自动） | 唯一记录 ID |
| `device_id` | string | 来源设备标识 |
| `user_phone` | string | 绑定用户手机号 |
| `file_id` | string | 上传图片的云存储文件 ID |
| `image_url` | string | 图片访问临时 URL |
| `ai_result` | object | 结构化 AI 结果：`{ objects, scene, description, tags, confidence, words }` |
| `ai_model` | string | 使用的 AI 模型/供应商（如 `deepseek`、`gpt4v`、`gemini`） |
| `upload_time` | serverDate | 处理时间戳 |
| `upload_time_ms` | number | 时间戳（毫秒） |
| `image_size` | number | 图片大小（字节） |
| `status` | string | 成功时为 `completed` |

### 4.9 `user_api_configs` — 用户 AI 供应商 API 密钥

用户为其首选 AI 视觉供应商配置的 API 密钥。

| 字段 | 类型 | 说明 |
|---|---|---|
| `_id` | string（自动） | 唯一记录 ID |
| `user_id` | string | 用户 `_id` |
| `user_phone` | string | 用户手机号（用于向后兼容查询） |
| `selected_provider` | string | 当前选中的供应商（`deepseek`、`gpt4v`、`gemini`、`qwen`、`custom`） |
| `providers` | object | 各供应商配置：`{ providerName: { api_key, model_id, configured_at, endpoint?, model_name? } }` |
| `created_at` | serverDate | 创建时间戳 |
| `created_at_ms` | number | 时间戳（毫秒） |
| `updated_at` | serverDate | 最近更新时间 |
| `updated_at_ms` | number | 时间戳（毫秒） |

### 4.10 `vocabulary` — 提取的学习单词

从 AI 图像分析中提取的英文词汇单词。

| 字段 | 类型 | 说明 |
|---|---|---|
| `_id` | string（自动） | 唯一单词记录 ID |
| `word` | string | 英文单词 |
| `phonetic` | string | 发音（国际音标或简化版） |
| `meaning` | string | 中文释义 |
| `sentence` | string | 包含该单词的例句 |
| `status` | string | 学习状态：`new`、`learning`、`mastered` |
| `review_count` | number | 复习/标记次数 |
| `user_phone` | string | 所有者手机号（数据隔离） |
| `source_device_id` | string | 捕获源图像的设备 |
| `source_image_id` | string | 引用 `devices` 记录 |
| `created_at` | serverDate | 创建时间戳 |
| `created_at_ms` | number | 时间戳（毫秒） |

---

## 5. 云开发资源

### 微信云开发环境

- **环境 ID**：`your-cloud-environment-id`
- **数据库**：JSON 文档存储，含 10 个集合（见第 4 节）
- **文件存储**：将上传的 JPEG 图片存储在 `device-uploads/YYYYMMDD/<device_id>/` 路径下
- **云函数**：已部署 6 个函数（见下文）

### 云函数

| 函数 | 类型 | 用途 |
|---|---|---|
| `userAuth` | 可调用 | 注册、登录、会话验证、退出、用户列表、用户统计、敏感数据查询、验证码发送、账户找回 |
| `bindDevice` | 可调用 | 设备与用户绑定（含会话验证和手机号绑定校验） |
| `uploadImage` | HTTP 触发器（POST） | 接收来自 ESP32 的 JPEG，验证设备绑定，上传至存储，调用 AI 视觉 API，提取词汇 |
| `initDeviceBindings` | 可调用 | 一次性初始化 `device_bindings` 集合及索引 |
| `saveApiConfig` | 可调用 | 保存、获取、删除和测试用户 AI 供应商 API 密钥配置 |
| `vocabApi` | 可调用 | 分页列出词汇单词，获取学习统计，更新单词状态 |

### 外部 AI 服务

`uploadImage` 云函数支持调用以下 AI 视觉 API，可按用户配置：

- **DeepSeek（深度求索）** — `https://api.deepseek.com/v1/chat/completions`（模型：`deepseek-chat`）
- **GPT-4 Vision（OpenAI）** — `https://api.openai.com/v1/chat/completions`（模型：`gpt-4o`）
- **Gemini Pro（Google）** — `https://generativelanguage.googleapis.com/v1beta/models/`（模型：`gemini-2.0-flash`）
- **通义千问 VL（阿里云）** — `https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions`（模型：`qwen-vl-plus`）
- **自定义模型** — 任何 OpenAI 兼容的 API 接口（用户自提供 URL、模型名称和 API 密钥）

---

## 6. 安装与部署

### 6.1 前置条件

- **硬件**：ESP32-CAM AI-Thinker 模块（含 OV2640 或 OV3660 摄像头）、USB 转串口适配器
- **软件**：[PlatformIO IDE](https://platformio.org/)（VS Code 扩展）或 PlatformIO Core CLI、[微信开发者工具](https://developers.weixin.qq.com/miniprogram/dev/devtools/download.html)
- **账号**：微信小程序 AppID（请将 `your-wechat-app-id` 替换为您自己注册的 AppID）、微信云开发环境、AI 供应商 API 密钥（DeepSeek、OpenAI、Google 或阿里云）

### 6.2 SmartGlasses_MVP（ESP32 固件）

1. **安装 PlatformIO**（推荐 VS Code 扩展）。

2. **打开项目**：
   ```bash
   cd SmartGlasses_MVP
   # 在 VS Code 或 PlatformIO IDE 中打开
   ```

3. **在 `platformio.ini` 中配置 WiFi 凭据**（⚠️ 切勿提交真实凭据）：
   ```ini
   build_flags =
       -DCONFIG_WIFI_SSID=\"你的WiFi名称\"
       -DCONFIG_WIFI_PASSWORD=\"你的WiFi密码\"
   ```

4. **在 `src/main.c` 第 42 行设置上传 URL**（⚠️ 切勿提交真实 URL）：
   ```c
   #define UPLOAD_URL "https://your-cloud-environment-id.service.tcloudbase.com/uploadImage"
   ```
   将 `your-cloud-environment-id` 替换为您的实际云开发环境 ID。从已部署的 `uploadImage` 云函数获取准确的 HTTP 触发器地址。

5. **在 `platformio.ini` 中配置上传端口**（⚠️ 切勿提交真实端口路径）：
   ```ini
   upload_port = /dev/cu.usbserial-XXXX      # macOS (replace with your port)
   monitor_port = /dev/cu.usbserial-XXXX     # macOS (replace with your port)
   ```
   根据操作系统调整（如 Windows 上为 `COM3`，Linux 上为 `/dev/ttyUSB0`）。

6. **构建并烧录**：
   ```bash
   pio run --target upload
   ```

7. **查看串口输出**：
   ```bash
   pio device monitor
   ```

8. **验证**：启动后，串口监视器显示 WiFi 连接和 IP 地址。在浏览器中打开 `http://<device-ip>/` 验证摄像头是否正常工作。

### 6.3 User_UI（微信小程序）

1. **打开微信开发者工具**。

2. **导入项目**：选择 `User_UI/` 目录。

3. **设置 AppID**：使用 `your-wechat-app-id` 或您自己注册的 AppID。

4. **云环境**已在 `app.js` 中配置：
   ```javascript
   env: 'your-cloud-environment-id'
   ```

5. **在测试前确保云函数已部署**（见 6.4 节）。

6. **预览**：点击"预览"在手机上测试，或使用内置模拟器。

### 6.4 admin（云函数和管理后台）

#### 云函数部署

1. **打开微信开发者工具**，导入 `admin/` 目录。

2. **部署每个云函数**：在云函数面板中右键点击函数文件夹，选择"上传并部署：安装依赖"：

   按以下顺序部署：
   - `initDeviceBindings`
   - `userAuth`
   - `bindDevice`
   - `uploadImage`（部署后还需配置 HTTP 触发器）
   - `saveApiConfig`
   - `vocabApi`

3. **为 `uploadImage` 配置 HTTP 触发器**：
   - 在微信云开发控制台中，导航至 云函数 → `uploadImage`
   - 添加 HTTP 触发器，方法：**仅 POST**
   - 复制生成的触发器 URL，更新 `SmartGlasses_MVP/src/main.c` 中的 `UPLOAD_URL`

4. **初始化数据库**：调用一次初始化函数：
   ```javascript
   wx.cloud.callFunction({ name: 'initDeviceBindings' })
   ```
   这将创建 `device_bindings` 集合及所需索引。如果云策略限制索引创建，请在云开发控制台中手动创建。

5. **导入设备主数据**到 `devices` 集合（可选，用于 `bindDevice` 中的设备存在校验）：
   ```json
   {
     "device_id": "A1B2C3D4E5F6",
     "model": "AIGlass-MVP",
     "status": "ready"
   }
   ```

6. **为云函数设置环境变量**（见第 10 节）。

---

## 7. 组件交互与数据流

### 图像采集与处理流程

```
   ESP32-CAM                   云函数                          微信小程序
   ─────────                   ──────                          ──────────

1. 按键按下
   (GPIO13 中断)
         │
2. esp_camera_fb_get()
   采集 JPEG 帧
   (SVGA 800×600)
         │
3. HTTPS POST ────────────►  uploadImage (HTTP 触发器)
   binary image/jpeg           │
   Header: X-Device-ID         ├─ 4. 验证 device_bindings
                               │    (检查设备是否已绑定)
                               │
                               ├─ 5. cloud.uploadFile()
                               │    将 JPEG 存入云存储
                               │
                               ├─ 6. 获取用户 API 配置
                               │    从 user_api_configs
                               │
                               ├─ 7. 调用 AI 视觉 API
                               │    (DeepSeek/GPT-4V/Gemini/Qwen/自定义)
                               │    以 base64 发送图片
                               │
                               ├─ 8. 解析 AI JSON 响应
                               │    { objects, scene, description,
                               │      tags, confidence, words }
                               │
                               ├─ 9. 写入 devices 集合
                               │
                               ├─ 10. 提取词汇单词
                               │      写入 vocabulary 集合
                               │
                               └─ 11. 返回 200 ────────────►
                                                              12. 数据库监听器
                                                                 检测到 devices
                                                                 集合中的新记录
                                                                       │
                                                              13. 弹窗显示
                                                                 AI 结果
                                                                       │
                                                              14. 用户浏览
                                                                 词汇单词
                                                                 并标记掌握
```

### 认证流程

```
   User_UI 小程序                          userAuth 云函数
   ──────────────                          ────────────────

   注册：
   phone + code + password  ──────────►  verifyCode(phone, code)
                                        在 users 集合中创建用户
                                        autoBindPhoneForUser (phone_bindings)
                                        返回 sessionToken

   登录：
   account + password       ──────────►  findUserByAccount (手机号或 accountId)
                                        hashPassword + 比对
                                        autoBindPhoneForUser (登录时绑定)
                                        更新 sessionToken、loginCount
                                        使用 AES-256-CBC 加密密码
                                        返回 sessionToken

   会话恢复：
   sessionToken             ──────────►  verifySession
   (存储在 wx.storage)                  检查 users 集合
                                        验证过期时间
                                        返回 userInfo
```

### 设备绑定流程

```
   User_UI (device-bind 页面)            bindDevice 云函数
   ──────────────────────────            ──────────────────

   sessionToken + Device_ID  ──────────► getLoginUser (验证会话)
                                        验证 phone binding 是否存在
                                        检查 device_bindings：
                                          情况1：未绑定 → 创建绑定
                                          情况2：同一用户 → 幂等成功
                                          情况3：不同用户 → 409 冲突
                                        写入 device_binding_logs
```

---

## 8. 核心功能

### 8.1 用户注册与登录

- 手机号注册，需 6 位短信验证码
- 国际手机号支持（标准化为 `+<国家代码><号码>` 格式，中国大陆号码自动添加 `+86` 前缀）
- 注册时密码强度指示器
- SHA-256 密码哈希，每用户随机盐值
- 7 天会话令牌，自动过期
- "记住我"账户持久化
- 通过手机号和验证码找回账户

### 8.2 设备绑定

- 手动输入 Device ID（8-32 位字母数字编码）
- 扫码自动填入 Device ID
- 三种绑定逻辑：新绑定、幂等重新绑定（同一用户）、冲突拒绝（不同用户）
- 要求：设备绑定前必须已完成手机号与账户的绑定
- 幂等性：同一设备对同一用户的重复绑定会优雅成功，并提示"已绑定"
- 将已绑定设备信息持久化到本地存储和 globalData，供各页面展示

### 8.3 图像采集与上传

- **物理按键**：按下 GPIO13 上的按键触发采集 + 上传
- **串口命令**：在串口监视器中输入 `p` 或 `P`（115200 波特率）
- **浏览器查看**：访问 `http://<device-ip>/` 或 `http://<device-ip>/capture.jpg` 获取实时 JPEG 流
- 重试逻辑：最多 3 次重试，指数退避（2 秒、4 秒、6 秒间隔）
- 大图上传 35 秒 HTTP 超时
- 互斥锁保护摄像头访问，防止并发采集冲突

### 8.4 AI 视觉处理

- **多供应商支持**：DeepSeek、GPT-4 Vision、Gemini Pro、通义千问 VL 以及自定义 OpenAI 兼容接口
- **每用户 API 密钥配置**：每个用户可使用自己的 API 密钥
- **视觉提示词**：结构化 JSON 输出，包含物体、场景描述、标签、置信度和词汇单词
- **词汇提取**：每张图片 3-10 个英文单词，附带音标、中文释义和例句
- **供应商回退**：如果用户未配置任何供应商，回退到默认 DeepSeek
- **API 密钥测试**：用户可通过小程序在保存前验证 API 密钥

### 8.5 词汇学习

- 从 AI 处理中提取的单词存储在 `vocabulary` 集合中
- 三种学习状态：`new`（新词）、`learning`（学习中）、`mastered`（已掌握）
- 分页单词列表，支持下拉刷新和滚动加载更多
- 学习统计仪表盘：总词数、已掌握数、今日数
- 一键"标记为已掌握"，复习计数递增
- 单词关联到来源设备和图片，可追溯

### 8.6 实时 AI 结果

- `devices` 集合上的数据库监听器实时检测新记录
- 新 AI 结果到达时弹窗通知
- 历史结果列表，支持分页
- 图片预览，支持缩放
- AI 模型归属标注，显示每张图片的处理供应商
- 本地化格式的时间戳显示

### 8.7 管理后台仪表盘

- 用户统计：总用户数、活跃用户、今日登录、7 日登录
- 用户表，支持分页和状态筛选
- 显示字段：账号、手机号（脱敏）、状态、登录次数、创建时间、最近登录、OpenID
- 超时容错数据加载，使用 `Promise.allSettled` 和降级显示
- 可直接导航至任意用户的超级管理员敏感查询

### 8.8 超级管理员

- 受 `SUPER_ADMIN_KEY` 环境变量保护
- 通过用户 ID 或手机号查询敏感用户数据
- 查看解密后的明文密码（AES-256-CBC 解密）
- 支持历史手机号格式（向后兼容的手机号查询）
- 从仪表盘用户卡片导航时自动填入用户 ID
- 所有敏感查询均审计记录至 `binding_audit_logs`

---

## 9. 安全考量

### 9.1 认证

- **密码存储**：密码使用 SHA-256 进行哈希，公式为 `SHA-256(password + randomSalt + AUTH_HASH_SECRET)`——绝不存储明文。
- **密码恢复**：明文密码使用 AES-256-CBC 加密，使用单独的 `PASSWORD_ENCRYPT_SECRET` 密钥，仅供超级管理员访问。
- **会话管理**：会话令牌为 24 个十六进制字符的随机字符串，TTL 为 7 天。令牌在退出时失效，每次认证请求均进行校验。
- **登录追踪**：每次成功登录时更新登录计数、最近登录时间戳和会话过期时间。

### 9.2 手机号隐私

- `users` 集合中存储的手机号使用 SHA-256 哈希（`phoneHash`）作为主要查询键。
- `phone_bindings` 集合使用哈希作为文档 `_id` 以实现天然唯一性。
- 管理后台仪表盘仅显示脱敏手机号（`phoneMasked`，如 `+861****000`）。
- 手机号查询通过 `getPhoneQueryCandidates` 进行标准化，以支持多种历史格式。

### 9.3 设备安全

- 设备身份基于 ESP32 的 WiFi MAC 地址（12 个十六进制字符）生成。
- 如果设备未在 `device_bindings` 中绑定到任何用户，图片上传将被拒绝（HTTP 403）。
- 设备绑定需要：有效的用户会话、手机号与账户绑定校验以及唯一性强制。
- 绑定冲突（设备已绑定到不同用户）将被记录并以 HTTP 409 拒绝。

### 9.4 API 密钥保护

- 存储在 `user_api_configs` 中的用户 API 密钥仅对所有者用户可访问（通过会话校验）。
- 获取显示时，API 密钥将被脱敏（如 `****a1b2`，仅显示最后 4 个字符）。
- API 密钥测试端点（`saveApiConfig.testKey`）无需会话认证，但仅执行校验——密钥永远不会在响应中暴露。
- API 密钥有长度约束校验（密钥 10-256 字符，模型 ID 最多 128 字符）。

### 9.5 审计日志

- **`binding_audit_logs`**：记录所有手机号绑定操作（自动绑定成功/失败、管理员敏感查询、账户找回）。
- **`device_binding_logs`**：记录所有设备绑定尝试，含结果和场景分类。
- **`device_upload_logs`**：记录每次图片上传尝试（成功和失败），含设备 ID、结果和使用的 AI 模型。
- 超级管理员敏感查询记录 userId、accountId 以及明文密码是否可用。

### 9.6 管理员访问控制

- 超级管理员功能需要匹配 `SUPER_ADMIN_KEY` 环境变量。
- 代码中存在默认值（`your-super-admin-key-here`），但**必须在生产环境中通过环境变量覆盖**。
- 如果未配置 `SUPER_ADMIN_KEY`，所有敏感查询将被拒绝。

---

## 10. 配置与环境变量

### 10.1 SmartGlasses_MVP（ESP32 固件）

通过 `platformio.ini` 构建标志配置：

| 变量 | 默认值 | 说明 |
|---|---|---|
| `CONFIG_WIFI_SSID` | `YourWiFiSSID` | WiFi 网络名称 |
| `CONFIG_WIFI_PASSWORD` | `YourWiFiPassword` | WiFi 密码 |

通过 `src/main.c` 中的 `#define` 配置：

| 常量 | 行号 | 说明 |
|---|---|---|
| `UPLOAD_URL` | 42 | 图片上传 HTTPS 端点 |
| `BUTTON_GPIO` | 49 | 采集按键 GPIO 引脚（默认：13） |
| `MAX_RETRY` | 43 | 最大上传重试次数（默认：3） |
| `HTTP_TIMEOUT_MS` | 44 | 上传 HTTP 超时（默认：35000 毫秒） |

### 10.2 云函数（环境变量）

> **🔒 关键提示：以下所有默认值均为文档占位符。** 部署到生产环境前，必须将每个变量覆盖为您自己生成的强随机密钥。切勿在线上环境中使用占位符值——它们不是真正的密钥，不提供任何安全保护。

在微信云开发控制台 → 云函数 → 选择函数 → 环境变量中设置：

| 变量 | 使用者 | 默认值 | 说明 |
|---|---|---|---|
| `AUTH_HASH_SECRET` | `userAuth` | `your-auth-hash-secret-here` | 密码哈希和手机号哈希的密钥 |
| `PASSWORD_ENCRYPT_SECRET` | `userAuth` | `<your-auth-hash-secret-here>_Password_Encrypt` | 密码存储 AES-256-CBC 加密密钥 |
| `SUPER_ADMIN_KEY` | `userAuth` | `your-super-admin-key-here` | 敏感数据访问管理员密钥（生产环境必须覆盖） |
| `EXPOSE_VERIFY_CODE` | `userAuth` | `true` | 是否在 API 响应中暴露验证码（仅开发环境） |
| `DEEPSEEK_API_KEY` | `uploadImage` | （无） | 默认 DeepSeek API 密钥（用户未配置时使用） |

### 10.3 微信云环境

> **📋 注意：** 以下环境 ID 和 AppID 为占位符。请替换为您在微信小程序管理后台和云开发控制台中获取的实际值。

| 参数 | 值 |
|---|---|
| 环境 ID | `your-cloud-environment-id` |
| 小程序 AppID | `your-wechat-app-id` |

### 10.4 微信开发者工具

- **基础库版本**：最低 2.2.3（admin/project.config.json 中配置为 3.15.2）
- **ES6→ES5**：已启用
- **代码压缩**：WXML 和 WXSS 已启用
- **云函数根目录**：`cloudfunctions/`
- **小程序根目录**：`miniprogram/`

---

## 11. 部署工作流与重要说明

### 11.1 完整部署顺序

全新部署请按以下顺序操作：

1. **在微信开发者工具中设置微信云开发环境**。

2. **部署云函数**（右键每个文件夹，上传并部署）：
   - `initDeviceBindings` → `userAuth` → `bindDevice` → `uploadImage` → `saveApiConfig` → `vocabApi`

3. **为 `uploadImage` 配置 HTTP 触发器**（仅 POST），复制 URL。

4. **在云开发控制台为 `userAuth` 和 `uploadImage` 设置环境变量**。

5. **初始化数据库**：调用 `wx.cloud.callFunction({ name: 'initDeviceBindings' })` 创建集合和索引。

6. **将设备主数据导入 `devices` 集合**，包含出厂设备 ID。

7. **更新 `SmartGlasses_MVP/src/main.c` 中的 `UPLOAD_URL`** 为 HTTP 触发器 URL。

8. **在 `SmartGlasses_MVP/platformio.ini` 中配置 WiFi 凭据**。

9. **构建并烧录 ESP32 固件**：
   ```bash
   cd SmartGlasses_MVP
   pio run --target upload
   ```

10. **在微信开发者工具中打开 User_UI**，验证云环境正确，测试注册/登录流程。

11. **打开 admin 小程序**，验证仪表盘能从 `userAuth` 加载用户数据。

### 11.2 DEVICE_BINDING_DEPLOY.md 重要说明

- `uploadImage` 云函数必须配置为 HTTP 触发器且仅允许 POST 方法。否则 ESP32 无法上传图片。
- 部署云函数后，调用一次 `initDeviceBindings` 初始化索引。如果因云策略限制导致索引创建失败，请在云开发控制台手动添加索引：
  - `device_id` 唯一索引（防止重复绑定）
  - `device_id` 非唯一索引
  - `user_phone` 非唯一索引
- 必须在 `devices` 集合中预加载设备主数据，以供 `bindDevice` 函数进行设备存在校验。
- `main.c` 中的 `UPLOAD_URL` 必须与已部署的 `uploadImage` HTTP 触发器 URL 完全一致。

### 11.3 问题排查文档重要说明

- **管理后台仪表盘数据源**：`admin/miniprogram/pages/dashboard/` 中的管理仪表盘查询的是 `userAuth`（而非 `vocabApi`）。请确保仪表盘页面正确连接到用户认证云函数。
- **设备绑定需要手机号绑定**：用户必须先完成手机号绑定（登录/注册时自动完成）才能绑定设备。如果绑定时提示"手机号未绑定"，用户应退出登录后重新登录。
- **历史手机号格式兼容**：系统通过 `getPhoneQueryCandidates` 支持多种手机号格式，该函数同时生成基于哈希和明文的候选值，以兼容迁移前的用户数据。
- **超级管理员密码恢复**：如果历史用户的 `passwordRawEncrypted` 为空，则该用户必须在修复部署后至少登录一次，明文密码才能在超级管理员面板中显示。
- **超时容错**：管理后台仪表盘使用 `Promise.allSettled` 和 `callCloudSafe`，超时设为 7 秒。如果某个请求超时，页面会优雅降级而非完全失败。

### 11.4 常见问题排查

| 现象 | 可能原因 | 解决方法 |
|---|---|---|
| ESP32 上传失败，HTTP 403 | 设备未在 `device_bindings` 中绑定 | 通过 User_UI 设备绑定页面绑定设备 |
| ESP32 上传失败，HTTP 500 "No AI API key" | 未设置 DEEPSEEK_API_KEY 环境变量且用户未配置 API | 在云函数环境变量中设置 DEEPSEEK_API_KEY，或在微信小程序中配置 API 密钥 |
| 小程序报"云函数未部署"错误 | 云函数未部署或环境不正确 | 在微信开发者工具中部署云函数 |
| 管理后台仪表盘显示词汇数据而非用户数据 | 数据源错误 | 确保仪表盘调用 `userAuth` 的 `userStats` 和 `listUsers` 操作 |
| 设备绑定失败，提示"手机号未绑定" | 手机号自动绑定未完成 | 退出登录后重新登录触发自动绑定，然后重试绑定 |
| 超级管理员查询密码返回"--" | 历史用户，修复后从未登录 | 让用户登录一次后再查询 |
| ESP32 摄像头初始化失败 | 开发板或摄像头模块不正确 | 验证 ESP32-CAM AI-Thinker 引脚配置，检查 PSRAM 是否启用 |

### 11.5 生产环境加固清单

> **⚠️ 提醒：** 本 README 中的所有占位符值（如 `your-cloud-environment-id`、`your-wechat-app-id`、`your-auth-hash-secret-here`、`your-super-admin-key-here`、`YourWiFiSSID`、`YourWiFiPassword`）仅供文档使用。部署前请将每一个占位符替换为您自己的私有值。

- [ ] 设置强且唯一的 `SUPER_ADMIN_KEY` 环境变量（切勿使用占位符 `your-super-admin-key-here`）
- [ ] 设置强且唯一的 `AUTH_HASH_SECRET` 环境变量
- [ ] 设置强且唯一的 `PASSWORD_ENCRYPT_SECRET` 环境变量
- [ ] 将 `EXPOSE_VERIFY_CODE` 设为 `false`（生产环境绝不暴露验证码）
- [ ] 配置真实短信服务发送验证码（当前实现为服务端生成验证码但未发送短信）
- [ ] 如可能，限制 `uploadImage` HTTP 触发器仅接受来自 ESP32 IP 范围的请求
- [ ] 定期检查并轮换所有 API 密钥
- [ ] 在云开发控制台设置适当的数据库权限规则
- [ ] 启用云函数日志和监控
- [ ] 重大迁移前备份数据库集合
- [ ] 确保 `SmartGlasses_MVP/platformio.ini` 和 `SmartGlasses_MVP/src/main.c` 列入 `.gitignore` 或使用环境特定文件，避免提交 WiFi 密码和上传 URL
- [ ] 在推送至公开仓库前，确认所有已提交文件中不存在真实凭证、API 密钥或环境 ID
