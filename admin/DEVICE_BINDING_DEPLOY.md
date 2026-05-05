# 智能眼镜绑定与图片上传部署说明

## 1. 部署云函数

在微信开发者工具中打开 `admin` 项目，上传并部署以下函数：

- `initDeviceBindings`
- `bindDevice`
- `uploadImage`（需要配置为 **HTTP 触发器**，只允许 `POST`）
- `userAuth`（已启用登录后手机号自动绑定）

## 2. 初始化数据库集合与索引

部署完成后调用一次：

- `wx.cloud.callFunction({ name: 'initDeviceBindings' })`

该步骤会初始化集合 `device_bindings`，并尝试创建索引：

- `device_id` 唯一索引（防止重复绑定）
- `device_id` 普通索引（查询优化）
- `user_phone` 普通索引（查询优化）

> 说明：若云端索引创建被策略限制，可在 CloudBase 控制台为 `device_bindings` 手动补齐以上索引。

## 3. 设备主数据（用于“设备ID不存在”校验）

`bindDevice` 会在 `devices` 集合查找 `device_id` 是否存在。请提前导入出厂设备列表，例如：

```json
{
  "device_id": "A1B2C3D4E5F6",
  "model": "AIGlass-MVP",
  "status": "ready"
}
```

## 4. 小程序端

`User_UI` 已新增页面：

- `pages/device-bind/device-bind`

功能：

- 登录后手机号自动绑定（无独立授权步骤）
- 手输 `Device_ID`
- 扫码自动识别 `Device_ID`
- 调用 `bindDevice(sessionToken + Device_ID)` 并展示成功/失败弹窗

## 5. ESP32 上传端

`SmartGlasses_MVP/src/main.c` 已实现：

- HTTPS `POST` 上传
- 请求头 `X-Device-ID`
- JSON 负载（`image_base64`）
- 请求超时与指数退避重试（有限次数）

请把 `UPLOAD_URL` 改成 `uploadImage` 的 HTTP 触发器地址。

## 6. 上传拦截逻辑

`uploadImage` 云函数行为：

1. 从 Header 读取 `X-Device-ID`
2. 查询 `device_bindings` 验证绑定关系
3. 未绑定直接返回 `403` 与 `Device not bound`
4. 已绑定则上传图片到云存储并返回 `200`
5. 所有请求写入 `device_upload_logs`（成功与失败都记录）
