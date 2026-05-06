/**
 * AIGlass ESP32-CAM Firmware
 * 
 * - Camera initialization (ESP32-CAM AI-Thinker module)
 * - WiFi connection
 * - JPEG capture at SVGA resolution
 * - Button-triggered capture on GPIO (IO0 by default)
 * - HTTP POST upload to WeChat cloud function (uploadImage)
 *
 * All status feedback via serial monitor (115200 baud).
 * Run `pio device monitor` or open Serial Monitor to view.
 *
 * NOTE: On ESP32-CAM AI-Thinker, GPIO0 is shared with CAM_PIN_XCLK.
 *       If using the onboard BOOT button (GPIO0), change BUTTON_GPIO to
 *       an available pin (e.g. GPIO13, GPIO12) or use an external button.
 */
#include <stdio.h>
#include <string.h>
#include "esp_mac.h"
#include "esp_log.h"
#include "esp_http_client.h"
#include "esp_crt_bundle.h"
#include "esp_http_server.h"
#include "esp_wifi.h"
#include "esp_event.h"
#include "esp_netif.h"
#include "nvs_flash.h"
#include "esp_camera.h"
#include "sdkconfig.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/event_groups.h"
#include "freertos/queue.h"
#include "freertos/semphr.h"
#include "driver/gpio.h"

/* ── Configuration ─────────────────────────────────────────── */

#define WIFI_SSID       CONFIG_WIFI_SSID
#define WIFI_PASS       CONFIG_WIFI_PASSWORD

/* ⚠️  NEVER commit the real upload URL. Set it via
 *     -DCONFIG_UPLOAD_URL in platformio.ini build_flags,
 *     or an environment variable. */
#define UPLOAD_URL      CONFIG_UPLOAD_URL
#define MAX_RETRY       3
#define HTTP_TIMEOUT_MS 35000
#define HTTP_CAPTURE_PORT 80

/* ── Button Configuration ──────────────────────────────────── */

#define BUTTON_GPIO         GPIO_NUM_13
#define BUTTON_DEBOUNCE_MS  300

/* ── ESP32-CAM AI-Thinker Pin Definitions ──────────────────── */

#define CAM_PIN_PWDN    32
#define CAM_PIN_RESET   -1
#define CAM_PIN_XCLK     0
#define CAM_PIN_SIOD    26
#define CAM_PIN_SIOC    27

#define CAM_PIN_D7      35
#define CAM_PIN_D6      34
#define CAM_PIN_D5      39
#define CAM_PIN_D4      36
#define CAM_PIN_D3      21
#define CAM_PIN_D2      19
#define CAM_PIN_D1      18
#define CAM_PIN_D0       5

#define CAM_PIN_VSYNC   25
#define CAM_PIN_HREF    23
#define CAM_PIN_PCLK    22

#define CAM_XCLK_FREQ_HZ 20000000

/* ── Globals ───────────────────────────────────────────────── */

static const char *TAG = "AIGLASS";

static EventGroupHandle_t s_wifi_event_group;
#define WIFI_CONNECTED_BIT BIT0
#define WIFI_FAIL_BIT      BIT1

static int s_retry_num = 0;
#define WIFI_MAX_RETRY 10

static QueueHandle_t s_button_queue = NULL;
static SemaphoreHandle_t s_camera_mutex = NULL;
static httpd_handle_t s_http_server = NULL;
static esp_ip4_addr_t s_ip_addr;

#if CONFIG_SCCB_HARDWARE_I2C_PORT1
#define AIGLASS_SCCB_PORT 1
#else
#define AIGLASS_SCCB_PORT 0
#endif

/* ── Status print helper ──────────────────────────────────── */

static void print_status(const char *label)
{
    printf("\n");
    printf("========================================\n");
    printf("  [STATUS] %s\n", label);
    printf("========================================\n");
    printf("\n");
}

/* ── Button ISR ───────────────────────────────────────────── */

static void IRAM_ATTR button_isr_handler(void *arg)
{
    uint32_t gpio_num = (uint32_t)arg;
    xQueueSendFromISR(s_button_queue, &gpio_num, NULL);
}

static void button_init(void)
{
    s_button_queue = xQueueCreate(4, sizeof(uint32_t));

    gpio_config_t io_conf = {
        .pin_bit_mask = (1ULL << BUTTON_GPIO),
        .mode         = GPIO_MODE_INPUT,
        .pull_up_en   = GPIO_PULLUP_ENABLE,
        .pull_down_en = GPIO_PULLDOWN_DISABLE,
        .intr_type    = GPIO_INTR_NEGEDGE,
    };
    gpio_config(&io_conf);

    gpio_install_isr_service(0);
    gpio_isr_handler_add(BUTTON_GPIO, button_isr_handler, (void *)BUTTON_GPIO);

    ESP_LOGI(TAG, "Button initialized on GPIO%d (pull-up, falling edge interrupt)", BUTTON_GPIO);
}

/* ── WiFi Event Handler ───────────────────────────────────── */

static void wifi_event_handler(void *arg, esp_event_base_t event_base,
                               int32_t event_id, void *event_data)
{
    if (event_base == WIFI_EVENT && event_id == WIFI_EVENT_STA_START) {
        esp_wifi_connect();
    } else if (event_base == WIFI_EVENT && event_id == WIFI_EVENT_STA_DISCONNECTED) {
        if (s_retry_num < WIFI_MAX_RETRY) {
            esp_wifi_connect();
            s_retry_num++;
            ESP_LOGW(TAG, "WiFi reconnecting... attempt %d/%d", s_retry_num, WIFI_MAX_RETRY);
        } else {
            xEventGroupSetBits(s_wifi_event_group, WIFI_FAIL_BIT);
            ESP_LOGE(TAG, "WiFi connection failed after %d attempts", WIFI_MAX_RETRY);
        }
    } else if (event_base == IP_EVENT && event_id == IP_EVENT_STA_GOT_IP) {
        ip_event_got_ip_t *event = (ip_event_got_ip_t *)event_data;
        ESP_LOGI(TAG, "Connected! IP: " IPSTR, IP2STR(&event->ip_info.ip));
        s_ip_addr = event->ip_info.ip;
        s_retry_num = 0;
        xEventGroupSetBits(s_wifi_event_group, WIFI_CONNECTED_BIT);
    }
}

/* ── WiFi Initialization ──────────────────────────────────── */

static esp_err_t wifi_init_sta(void)
{
    s_wifi_event_group = xEventGroupCreate();

    ESP_ERROR_CHECK(esp_netif_init());
    ESP_ERROR_CHECK(esp_event_loop_create_default());
    esp_netif_create_default_wifi_sta();

    wifi_init_config_t cfg = WIFI_INIT_CONFIG_DEFAULT();
    ESP_ERROR_CHECK(esp_wifi_init(&cfg));

    esp_event_handler_instance_t instance_any_id;
    esp_event_handler_instance_t instance_got_ip;
    ESP_ERROR_CHECK(esp_event_handler_instance_register(
        WIFI_EVENT, ESP_EVENT_ANY_ID, &wifi_event_handler, NULL, &instance_any_id));
    ESP_ERROR_CHECK(esp_event_handler_instance_register(
        IP_EVENT, IP_EVENT_STA_GOT_IP, &wifi_event_handler, NULL, &instance_got_ip));

    wifi_config_t wifi_config = {
        .sta = {
            .ssid = WIFI_SSID,
            .password = WIFI_PASS,
            .threshold.authmode = WIFI_AUTH_WPA2_PSK,
        },
    };
    ESP_ERROR_CHECK(esp_wifi_set_mode(WIFI_MODE_STA));
    ESP_ERROR_CHECK(esp_wifi_set_config(WIFI_IF_STA, &wifi_config));
    ESP_ERROR_CHECK(esp_wifi_start());

    ESP_LOGI(TAG, "WiFi STA init done, connecting to %s ...", WIFI_SSID);

    EventBits_t bits = xEventGroupWaitBits(s_wifi_event_group,
        WIFI_CONNECTED_BIT | WIFI_FAIL_BIT,
        pdFALSE, pdFALSE, portMAX_DELAY);

    if (bits & WIFI_CONNECTED_BIT) {
        ESP_LOGI(TAG, "WiFi connected to SSID: %s", WIFI_SSID);
        return ESP_OK;
    }

    ESP_LOGE(TAG, "WiFi connection FAILED");
    return ESP_FAIL;
}

/* ── Camera Initialization ────────────────────────────────── */

static esp_err_t camera_init(void)
{
    camera_config_t config = {
        .pin_pwdn     = CAM_PIN_PWDN,
        .pin_reset    = CAM_PIN_RESET,
        .pin_xclk     = CAM_PIN_XCLK,
        .pin_sccb_sda = CAM_PIN_SIOD,
        .pin_sccb_scl = CAM_PIN_SIOC,

        .pin_d7 = CAM_PIN_D7,
        .pin_d6 = CAM_PIN_D6,
        .pin_d5 = CAM_PIN_D5,
        .pin_d4 = CAM_PIN_D4,
        .pin_d3 = CAM_PIN_D3,
        .pin_d2 = CAM_PIN_D2,
        .pin_d1 = CAM_PIN_D1,
        .pin_d0 = CAM_PIN_D0,

        .pin_vsync = CAM_PIN_VSYNC,
        .pin_href  = CAM_PIN_HREF,
        .pin_pclk  = CAM_PIN_PCLK,

        .xclk_freq_hz = CAM_XCLK_FREQ_HZ,
        .ledc_timer   = LEDC_TIMER_0,
        .ledc_channel = LEDC_CHANNEL_0,
        .pixel_format = PIXFORMAT_JPEG,
        .frame_size   = FRAMESIZE_SVGA,
        .jpeg_quality = 12,
        .fb_count     = 2,
        .grab_mode    = CAMERA_GRAB_WHEN_EMPTY,
    };

    esp_err_t err = esp_camera_init(&config);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "Camera init failed: 0x%x (%s)", err, esp_err_to_name(err));
        return err;
    }

    ESP_LOGI(TAG, "Camera initialized: SVGA 800x600, JPEG quality=%d, XCLK=%d Hz",
             config.jpeg_quality, config.xclk_freq_hz);

    /* ── OV3660-specific sensor tuning ── */
    sensor_t *s = esp_camera_sensor_get();
    if (s) {
        if (s->id.PID == OV3660_PID) {
            ESP_LOGI(TAG, "OV3660 sensor detected, applying optimizations");
            s->set_brightness(s, 1);
            s->set_contrast(s, 1);
            s->set_sharpness(s, 1);
            s->set_awb_gain(s, 1);
        } else {
            /* Generic sensor fallback */
            s->set_brightness(s, 0);
            s->set_contrast(s, 0);
            s->set_saturation(s, 0);
            s->set_whitebal(s, 1);
            s->set_awb_gain(s, 1);
            s->set_wb_mode(s, 0);
            s->set_aec2(s, 1);
            s->set_ae_level(s, 0);
            s->set_aec_value(s, 300);
            s->set_gain_ctrl(s, 1);
            s->set_agc_gain(s, 0);
            s->set_gainceiling(s, (gainceiling_t)6);
            s->set_bpc(s, 1);
            s->set_wpc(s, 1);
            s->set_lenc(s, 1);
            s->set_hmirror(s, 0);
            s->set_vflip(s, 0);
            ESP_LOGI(TAG, "Sensor parameters configured (AWB, AEC, AGC enabled)");
        }
    }

    return ESP_OK;
}

/* ── Device ID from MAC ───────────────────────────────────── */

static void get_device_id(char *out, size_t out_len)
{
    uint8_t mac[6];
    esp_read_mac(mac, ESP_MAC_WIFI_STA);
    snprintf(out, out_len, "%02X%02X%02X%02X%02X%02X",
             mac[0], mac[1], mac[2], mac[3], mac[4], mac[5]);
}

/* ── HTTP Response Buffer ─────────────────────────────────── */

#define RESP_BUF_SIZE 1024
static char s_resp_buf[RESP_BUF_SIZE];
static int  s_resp_len = 0;

static esp_err_t http_event_handler(esp_http_client_event_t *evt)
{
    if (evt->event_id == HTTP_EVENT_ON_DATA) {
        int copy = evt->data_len;
        if (s_resp_len + copy >= RESP_BUF_SIZE) {
            copy = RESP_BUF_SIZE - s_resp_len - 1;
        }
        if (copy > 0) {
            memcpy(s_resp_buf + s_resp_len, evt->data, copy);
            s_resp_len += copy;
        }
    }
    return ESP_OK;
}

/* ── Upload JPEG via HTTP POST (raw binary) ───────────────── */

static int upload_image(const uint8_t *jpeg_buf, size_t jpeg_len, const char *device_id)
{
    ESP_LOGI(TAG, "  Uploading %u bytes JPEG, device=%s", (unsigned)jpeg_len, device_id);

    s_resp_len = 0;
    memset(s_resp_buf, 0, RESP_BUF_SIZE);

    esp_http_client_config_t config = {
        .url               = UPLOAD_URL,
        .method            = HTTP_METHOD_POST,
        .timeout_ms        = HTTP_TIMEOUT_MS,
        .crt_bundle_attach = esp_crt_bundle_attach,
        .event_handler     = http_event_handler,
    };

    esp_http_client_handle_t client = esp_http_client_init(&config);
    if (!client) {
        ESP_LOGE(TAG, "  HTTP client init failed");
        return -1;
    }

    esp_http_client_set_header(client, "Content-Type", "image/jpeg");
    esp_http_client_set_header(client, "X-Device-ID", device_id);
    esp_http_client_set_post_field(client, (const char *)jpeg_buf, jpeg_len);

    esp_err_t err = esp_http_client_perform(client);
    int status_code = esp_http_client_get_status_code(client);
    esp_http_client_cleanup(client);

    if (err != ESP_OK) {
        ESP_LOGE(TAG, "  HTTP POST failed: %s", esp_err_to_name(err));
        return -1;
    }

    s_resp_buf[s_resp_len] = '\0';
    ESP_LOGI(TAG, "  Response [%d]: %s", status_code, s_resp_buf);

    if (status_code < 200 || status_code >= 300) {
        ESP_LOGW(TAG, "  Upload rejected, status=%d", status_code);
        return -1;
    }

    return 0;
}

/* ── Browser Capture HTTP Server ──────────────────────────── */

static esp_err_t browser_capture_handler(httpd_req_t *req)
{
    if (s_camera_mutex && xSemaphoreTake(s_camera_mutex, pdMS_TO_TICKS(10000)) != pdTRUE) {
        httpd_resp_send_err(req, HTTPD_500_INTERNAL_SERVER_ERROR, "Camera is busy");
        return ESP_FAIL;
    }

    camera_fb_t *fb = esp_camera_fb_get();
    if (!fb) {
        if (s_camera_mutex) {
            xSemaphoreGive(s_camera_mutex);
        }
        ESP_LOGE(TAG, "Browser capture failed: camera_fb_get returned NULL");
        httpd_resp_send_err(req, HTTPD_500_INTERNAL_SERVER_ERROR, "Camera capture failed");
        return ESP_FAIL;
    }

    if (fb->format != PIXFORMAT_JPEG) {
        ESP_LOGE(TAG, "Browser capture failed: frame format=%d is not JPEG", fb->format);
        esp_camera_fb_return(fb);
        if (s_camera_mutex) {
            xSemaphoreGive(s_camera_mutex);
        }
        httpd_resp_send_err(req, HTTPD_500_INTERNAL_SERVER_ERROR, "Captured frame is not JPEG");
        return ESP_FAIL;
    }

    httpd_resp_set_type(req, "image/jpeg");
    httpd_resp_set_hdr(req, "Content-Disposition", "inline; filename=capture.jpg");
    httpd_resp_set_hdr(req, "Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
    httpd_resp_set_hdr(req, "Pragma", "no-cache");
    httpd_resp_set_hdr(req, "Access-Control-Allow-Origin", "*");

    esp_err_t ret = httpd_resp_send(req, (const char *)fb->buf, fb->len);
    ESP_LOGI(TAG, "Browser capture served: %ux%u, %u bytes, ret=0x%x",
             fb->width, fb->height, (unsigned)fb->len, ret);

    esp_camera_fb_return(fb);
    if (s_camera_mutex) {
        xSemaphoreGive(s_camera_mutex);
    }
    return ret;
}

static esp_err_t browser_help_handler(httpd_req_t *req)
{
    char html[768];
    snprintf(html, sizeof(html),
             "<!doctype html>"
             "<html><head><meta charset=\"utf-8\">"
             "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">"
             "<title>AIGlass Camera</title></head>"
             "<body style=\"font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;margin:24px;\">"
             "<h2>AIGlass ESP32-CAM</h2>"
             "<p>Open <a href=\"/\">/</a> or <a href=\"/capture.jpg\">/capture.jpg</a> to capture one JPEG frame.</p>"
             "<p>Refresh the image URL to request a new photo from the camera.</p>"
             "<p>Current device IP: " IPSTR "</p>"
             "<p><img src=\"/capture.jpg?t=%lu\" style=\"max-width:100%%;height:auto;border:1px solid #ccc;\"></p>"
             "</body></html>",
             IP2STR(&s_ip_addr), (unsigned long)xTaskGetTickCount());

    httpd_resp_set_type(req, "text/html; charset=utf-8");
    httpd_resp_set_hdr(req, "Cache-Control", "no-store");
    return httpd_resp_send(req, html, HTTPD_RESP_USE_STRLEN);
}

static esp_err_t start_browser_capture_server(void)
{
    if (s_http_server) {
        return ESP_OK;
    }

    httpd_config_t config = HTTPD_DEFAULT_CONFIG();
    config.server_port = HTTP_CAPTURE_PORT;
    // config.ctrl_port = 32768;  // removed: not supported in ESP-IDF 5.x
    config.lru_purge_enable = true;

    esp_err_t ret = httpd_start(&s_http_server, &config);
    if (ret != ESP_OK) {
        ESP_LOGE(TAG, "HTTP server start failed: 0x%x (%s)", ret, esp_err_to_name(ret));
        s_http_server = NULL;
        return ret;
    }

    httpd_uri_t root_uri = {
        .uri = "/",
        .method = HTTP_GET,
        .handler = browser_capture_handler,
        .user_ctx = NULL,
    };
    httpd_uri_t capture_uri = {
        .uri = "/capture.jpg",
        .method = HTTP_GET,
        .handler = browser_capture_handler,
        .user_ctx = NULL,
    };
    httpd_uri_t help_uri = {
        .uri = "/help",
        .method = HTTP_GET,
        .handler = browser_help_handler,
        .user_ctx = NULL,
    };

    ESP_ERROR_CHECK(httpd_register_uri_handler(s_http_server, &root_uri));
    ESP_ERROR_CHECK(httpd_register_uri_handler(s_http_server, &capture_uri));
    ESP_ERROR_CHECK(httpd_register_uri_handler(s_http_server, &help_uri));

    ESP_LOGI(TAG, "Browser capture server started: http://" IPSTR "/", IP2STR(&s_ip_addr));
    ESP_LOGI(TAG, "Help page: http://" IPSTR "/help", IP2STR(&s_ip_addr));
    return ESP_OK;
}

/* ── Button-Triggered Capture & Upload Task ───────────────── */

static void capture_and_upload_task(void *arg)
{
    char device_id[13] = {0};
    get_device_id(device_id, sizeof(device_id));

    print_status("READY - WAITING FOR BUTTON PRESS");
    ESP_LOGI(TAG, "Device_ID  : %s", device_id);
    ESP_LOGI(TAG, "Button GPIO: %d", BUTTON_GPIO);
    ESP_LOGI(TAG, "Upload URL : %s", UPLOAD_URL);
    printf("----------------------------------------\n");
    printf("  Press the button to capture a photo.\n");
    printf("----------------------------------------\n\n");

    uint32_t gpio_num;
    TickType_t last_press_tick = 0;
    int capture_count = 0;

    while (1) {
        if (xQueueReceive(s_button_queue, &gpio_num, portMAX_DELAY) != pdTRUE) {
            continue;
        }

        /* Debounce */
        TickType_t now = xTaskGetTickCount();
        if ((now - last_press_tick) < pdMS_TO_TICKS(BUTTON_DEBOUNCE_MS)) {
            while (xQueueReceive(s_button_queue, &gpio_num, 0) == pdTRUE) {}
            continue;
        }
        last_press_tick = now;
        while (xQueueReceive(s_button_queue, &gpio_num, 0) == pdTRUE) {}

        capture_count++;
        printf("\n");
        printf("########################################\n");
        printf("  [CAPTURE #%d] Button pressed!\n", capture_count);
        printf("########################################\n");

        /* ── Step 1: Capture ── */
        ESP_LOGI(TAG, "[1/3] Capturing image...");
        if (s_camera_mutex && xSemaphoreTake(s_camera_mutex, pdMS_TO_TICKS(10000)) != pdTRUE) {
            ESP_LOGE(TAG, "[FAIL] Camera is busy");
            print_status("ERROR - CAMERA BUSY, WAITING FOR RETRY");
            continue;
        }

        camera_fb_t *fb = esp_camera_fb_get();
        if (!fb) {
            if (s_camera_mutex) {
                xSemaphoreGive(s_camera_mutex);
            }
            ESP_LOGE(TAG, "[FAIL] Camera capture failed!");
            print_status("ERROR - CAPTURE FAILED, WAITING FOR RETRY");
            continue;
        }

        ESP_LOGI(TAG, "[1/3] Captured: %ux%u, %u bytes, format=%d",
                 fb->width, fb->height, (unsigned)fb->len, fb->format);

        if (fb->format != PIXFORMAT_JPEG) {
            ESP_LOGE(TAG, "[FAIL] Frame is not JPEG (format=%d), skipping", fb->format);
            esp_camera_fb_return(fb);
            if (s_camera_mutex) {
                xSemaphoreGive(s_camera_mutex);
            }
            print_status("ERROR - NOT JPEG, WAITING FOR RETRY");
            continue;
        }

        /* ── Step 2: Upload ── */
        ESP_LOGI(TAG, "[2/3] Uploading to cloud...");
        int ok = -1;
        for (int retry = 0; retry < MAX_RETRY; retry++) {
            ok = upload_image(fb->buf, fb->len, device_id);
            if (ok == 0) break;
            ESP_LOGW(TAG, "  Upload retry %d/%d ...", retry + 1, MAX_RETRY);
            vTaskDelay(pdMS_TO_TICKS(2000 * (retry + 1)));
        }

        esp_camera_fb_return(fb);
        if (s_camera_mutex) {
            xSemaphoreGive(s_camera_mutex);
        }

        /* ── Step 3: Result ── */
        if (ok == 0) {
            ESP_LOGI(TAG, "[3/3] Upload SUCCESS");
            print_status("SUCCESS - UPLOAD COMPLETE");
        } else {
            ESP_LOGE(TAG, "[3/3] Upload FAILED after %d retries", MAX_RETRY);
            print_status("FAILED - UPLOAD ERROR");
        }

        printf("  Total captures: %d\n", capture_count);
        printf("  Press button for next capture.\n");
        printf("----------------------------------------\n\n");
    }
}

/* ── Serial Terminal Capture & Upload Test Task ──────────── */

static void serial_capture_task(void *arg)
{
    int capture_count = 0;
    char device_id[13] = {0};
    get_device_id(device_id, sizeof(device_id));

    printf("----------------------------------------\n");
    printf("  Serial command ready. Type p/P then Enter to capture & upload.\n");
    printf("  Device ID: %s\n", device_id);
    printf("----------------------------------------\n\n");

    while (1) {
        int input = getchar();
        if (input == EOF) {
            vTaskDelay(pdMS_TO_TICKS(50));
            continue;
        }

        char command = (char)input;
        if (command != 'p' && command != 'P') {
            continue;
        }

        capture_count++;
        printf("\n>>> 收到终端指令 p/P，开始抓拍并上传云端...\n");

        /* ── Step 1: Capture image ── */
        if (s_camera_mutex && xSemaphoreTake(s_camera_mutex, pdMS_TO_TICKS(10000)) != pdTRUE) {
            printf("[Error] 摄像头正忙，请稍后再试。\n");
            continue;
        }

        camera_fb_t *fb = esp_camera_fb_get();
        if (!fb) {
            if (s_camera_mutex) {
                xSemaphoreGive(s_camera_mutex);
            }
            printf("[Error] 拍照失败！请检查是否还有 VSYNC 溢出报错。\n");
            continue;
        }

        printf("[Success] 拍照成功！第 %d 张，获取到 %u 字节的 JPEG 图像数据，分辨率 %ux%u。\n",
               capture_count, (unsigned)fb->len, fb->width, fb->height);

        /* ── Step 2: Upload to cloud ── */
        printf(">>> 正在建立 HTTPS 连接并发送数据...\n");
        int upload_ok = upload_image(fb->buf, fb->len, device_id);

        /* ── Step 3: Report result ── */
        if (upload_ok == 0) {
            printf("[HTTP] 请求完成！云端返回状态码: 200\n");
            printf("🎉 太棒了！照片已成功送达云端后端！\n");
        } else {
            printf("[HTTP] 发送失败！请检查云函数日志。\n");
            printf("⚠️ 照片发过去了，但云端处理报错了，快去微信开发者工具看云函数日志！\n");
        }

        /* ── Step 4: Clean up ── */
        esp_camera_fb_return(fb);
        if (s_camera_mutex) {
            xSemaphoreGive(s_camera_mutex);
        }

        printf("----------------------------------------\n");
        printf("  Press p/P for next capture.\n");
        printf("----------------------------------------\n\n");
    }
}

/* ── Main Entry Point ─────────────────────────────────────── */

void app_main(void)
{
    printf("\n\n");
    printf("========================================\n");
    printf("    AIGlass ESP32-CAM Firmware v1.0\n");
    printf("========================================\n\n");

    /* 1. Initialize NVS */
    ESP_LOGI(TAG, "[BOOT 1/5] Initializing NVS...");
    esp_err_t ret = nvs_flash_init();
    if (ret == ESP_ERR_NVS_NO_FREE_PAGES || ret == ESP_ERR_NVS_NEW_VERSION_FOUND) {
        ESP_ERROR_CHECK(nvs_flash_erase());
        ret = nvs_flash_init();
    }
    ESP_ERROR_CHECK(ret);
    ESP_LOGI(TAG, "[BOOT 1/5] NVS OK");

    s_camera_mutex = xSemaphoreCreateMutex();
    if (!s_camera_mutex) {
        ESP_LOGE(TAG, "Camera mutex create failed");
        print_status("FATAL - CAMERA MUTEX FAILED, RESTARTING IN 5s");
        vTaskDelay(pdMS_TO_TICKS(5000));
        esp_restart();
    }

    /* 2. Initialize camera before WiFi to minimize power spikes and RF noise during SCCB probe */
    ESP_LOGI(TAG, "[BOOT 2/5] Initializing camera...");
    ESP_LOGI(TAG, "Camera config: PWDN=%d RESET=%d XCLK=%d SIOD=%d SIOC=%d D0-D7=%d,%d,%d,%d,%d,%d,%d,%d VSYNC=%d HREF=%d PCLK=%d XCLK_HZ=%d SCCB_PORT=%d SCCB_HZ=%d",
             CAM_PIN_PWDN, CAM_PIN_RESET, CAM_PIN_XCLK, CAM_PIN_SIOD, CAM_PIN_SIOC,
             CAM_PIN_D0, CAM_PIN_D1, CAM_PIN_D2, CAM_PIN_D3, CAM_PIN_D4, CAM_PIN_D5, CAM_PIN_D6, CAM_PIN_D7,
             CAM_PIN_VSYNC, CAM_PIN_HREF, CAM_PIN_PCLK, CAM_XCLK_FREQ_HZ, AIGLASS_SCCB_PORT, CONFIG_SCCB_CLK_FREQ);

    if (camera_init() != ESP_OK) {
        print_status("FATAL - CAMERA FAILED, RESTARTING IN 5s");
        vTaskDelay(pdMS_TO_TICKS(5000));
        esp_restart();
    }
    ESP_LOGI(TAG, "[BOOT 2/5] Camera OK");

    /* 3. Connect to WiFi after camera has been detected */
    ESP_LOGI(TAG, "[BOOT 3/5] Connecting to WiFi \"%s\"...", WIFI_SSID);
    if (wifi_init_sta() != ESP_OK) {
        print_status("FATAL - WIFI FAILED, RESTARTING IN 5s");
        vTaskDelay(pdMS_TO_TICKS(5000));
        esp_restart();
    }
    ESP_LOGI(TAG, "[BOOT 3/5] WiFi OK");

    /* 4. Warm up camera */
    ESP_LOGI(TAG, "[BOOT 4/5] Warming up camera...");
    for (int i = 0; i < 3; i++) {
        camera_fb_t *fb = esp_camera_fb_get();
        if (fb) esp_camera_fb_return(fb);
        vTaskDelay(pdMS_TO_TICKS(200));
    }
    ESP_LOGI(TAG, "[BOOT 4/5] Warm-up OK");

    if (start_browser_capture_server() != ESP_OK) {
        print_status("FATAL - HTTP SERVER FAILED, RESTARTING IN 5s");
        vTaskDelay(pdMS_TO_TICKS(5000));
        esp_restart();
    }

    printf("\n");
    printf("========================================\n");
    printf("  Browser capture ready\n");
    printf("  Open: http://" IPSTR "/\n", IP2STR(&s_ip_addr));
    printf("  Help : http://" IPSTR "/help\n", IP2STR(&s_ip_addr));
    printf("  Refresh the browser page to take a new photo.\n");
    printf("========================================\n\n");

    /* 5. Initialize button */
    ESP_LOGI(TAG, "[BOOT 5/5] Initializing button on GPIO%d...", BUTTON_GPIO);
    button_init();
    ESP_LOGI(TAG, "[BOOT 5/5] Button OK");

    /* Start task */
    xTaskCreatePinnedToCore(
        capture_and_upload_task,
        "cam_upload",
        8192,
        NULL,
        5,
        NULL,
        0
    );

    xTaskCreatePinnedToCore(
        serial_capture_task,
        "serial_capture",
        4096,
        NULL,
        4,
        NULL,
        0
    );
}
