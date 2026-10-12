# manager_npm_be

Backend của **Manager NPM**: công cụ chạy local để quét, phân tích và quản lý
các dự án Node.js/npm trên máy Windows. NestJS 11 + TypeScript.

- Chạy local, một người dùng: **không có xác thực/phân quyền, không có
  database** (đã loại bỏ khi dọn khung base-auth gốc). Dữ liệu là trạng thái
  filesystem tại thời điểm gọi API.
- API: `http://localhost:8080/api/v1`. Swagger (khi `MODE=development`):
  `http://localhost:8080/swagger`.
- Quy tắc an toàn: thao tác nguy hiểm (xoá file, đổi version global, đổi Node)
  đi theo cặp `preview` → `execute`; mọi path từ client phải nằm trong
  `SCAN_ROOT_PATHS`.

## Chạy

Yêu cầu: Node 24, pnpm 11.

```bash
pnpm install
# tạo .env từ .env.example, điền SCAN_ROOT_PATHS
pnpm dev
```

| Lệnh | Việc |
|---|---|
| `pnpm dev` | Chạy dev, tự reload (`nest start --watch`) |
| `pnpm lint` | ESLint (có `--fix`) |
| `pnpm build` | Build ra `dist/` |
| `pnpm start:prod` | Chạy bản build |
| `pnpm test` / `pnpm test:e2e` | Unit test / e2e test |

## Biến môi trường chính

Đầy đủ trong `.env.example`.

| Biến | Mặc định | Ý nghĩa |
|---|---|---|
| `MODE` | `development` | `development` bật Swagger |
| `HOST`, `PORT` | `localhost`, `8080` | Địa chỉ lắng nghe |
| `GLOBAL_PREFIX`, `VERSION` | `api`, `1` | URL dạng `/api/v1` |
| `LIST_ORIGIN_CORS` | `http://localhost:3000` | Origin của frontend được phép gọi |
| `EXPORT_SWAGGER_API_JSON` | `true` | Xuất `docs_API/swagger.json` khi dev (thư mục này không commit) |
| `SCAN_ROOT_PATHS` | (trống) | Các thư mục gốc để quét, phân cách bằng dấu phẩy; đồng thời là allowlist path |
| `MAX_SCAN_DEPTH` | `4` | Độ sâu tối đa khi quét |
| `NPM_COMMAND_TIMEOUT_MS` | `120000` | Timeout khi chạy lệnh npm/pnpm/yarn |
