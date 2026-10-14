# PkgSteward

**Ứng dụng web chạy local để quét, phân tích và quản lý các dự án Node.js / npm trên máy Windows của bạn.**

[![CI](https://github.com/LienThuan04/PkgSteward/actions/workflows/ci.yml/badge.svg)](https://github.com/LienThuan04/PkgSteward/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

[English](README.md) · Tiếng Việt

## Giới thiệu

PkgSteward chạy hoàn toàn trên máy của bạn: một API NestJS và giao diện web Next.js. Mục tiêu là trả lời các câu hỏi
như *"máy mình có những dự án nào, chúng phụ thuộc gì, gói nào đã cũ, `node_modules` chiếm bao nhiêu dung lượng?"*
và làm các việc thường gặp (cài/cập nhật package, xoá `node_modules`, đổi phiên bản package manager hoặc Node.js)
một cách an toàn.

- **Chạy local, một người dùng:** không tài khoản, không xác thực, không database. Dữ liệu được đọc trực tiếp từ
  filesystem tại thời điểm gọi API.
- **An toàn là trên hết:** mọi thao tác xoá hoặc ảnh hưởng toàn máy đều đi qua bước *xem trước → xác nhận*.

## Yêu cầu

- Windows 11
- Node.js 24 (xem [`.nvmrc`](.nvmrc))
- pnpm 11

## Bắt đầu

### 1. Cài đặt

```bash
git clone https://github.com/LienThuan04/PkgSteward.git
cd PkgSteward
cd pkgsteward_be && pnpm install && cd ..
cd pkgsteward_fe && pnpm install && cd ..
```

### 2. Cấu hình

Sao chép `pkgsteward_be/.env.example` thành `pkgsteward_be/.env` rồi điền `SCAN_ROOT_PATHS`. Các biến chính:

| Biến | Mặc định | Ý nghĩa |
|---|---|---|
| `MODE` | `development` | `development` bật Swagger |
| `HOST`, `PORT` | `localhost`, `24681` | Địa chỉ lắng nghe |
| `GLOBAL_PREFIX`, `VERSION` | `api`, `1` | Tiền tố URL, ví dụ `/api/v1` |
| `LIST_ORIGIN_CORS` | `http://localhost:24680` | Origin của frontend được CORS cho phép |
| `SCAN_ROOT_PATHS` | *(trống)* | Các thư mục gốc để quét, phân cách bằng dấu phẩy, hoặc `*` để quét mọi ổ đĩa cố định; đồng thời là danh sách path cho phép (thư mục hệ thống luôn bị loại) |
| `MAX_SCAN_DEPTH` | `4` | Độ sâu tối đa khi quét |
| `NPM_COMMAND_TIMEOUT_MS` | `120000` | Timeout khi chạy lệnh npm / pnpm / Yarn |

> [!IMPORTANT]
> API không có xác thực theo thiết kế. Giữ `HOST=localhost`, không mở API ra mạng.

### 3. Chạy

Nhấp đúp vào một script ở thư mục gốc của repo, hoặc chạy nó trong terminal:

| Script | Việc |
|---|---|
| `start-dev.bat` | Chạy backend và frontend ở chế độ development (watch / hot reload) |
| `start-prod.bat` | Build cả hai ứng dụng rồi chạy ở chế độ production (`MODE=production`, tắt Swagger) |

Mỗi ứng dụng mở trong một cửa sổ riêng; nhấn `Ctrl+C` hoặc đóng cửa sổ để dừng. Nếu chưa có `node_modules`, script
tự cài dependencies trước. Lệnh mà script chạy được khai báo ở đầu mỗi file.

| | URL |
|---|---|
| Giao diện web | http://localhost:24680 |
| API | http://localhost:24681/api/v1 |
| Swagger (chỉ development) | http://localhost:24681/swagger |

Muốn chạy riêng một ứng dụng, dùng các lệnh bên dưới trong thư mục của nó.

## Lệnh

| Ứng dụng | Lệnh | Việc |
|---|---|---|
| Backend | `pnpm dev` | Chạy ở chế độ watch |
| | `pnpm build` / `pnpm start:prod` | Biên dịch ra `dist/` / chạy bản đã biên dịch |
| | `pnpm lint` | ESLint (tự sửa) |
| | `pnpm test` / `pnpm test:e2e` | Unit test / e2e test (Jest) |
| Frontend | `pnpm dev` | Chạy dev server Next.js |
| | `pnpm build` / `pnpm start` | Build production / chạy bản build |
| | `pnpm lint` | ESLint |
| | `pnpm theme:check` | Kiểm tra độ tương phản WCAG AA của theme |
| | `pnpm i18n:check` | So key của từng ngôn ngữ với ngôn ngữ mặc định (`vi`): thừa key báo lỗi, thiếu key chỉ cảnh báo |

## Cấu trúc thư mục

```
pkgsteward_be/     API backend (NestJS 11)
pkgsteward_fe/     Giao diện web (Next.js 16, React 19, Tailwind CSS v4, shadcn/ui, next-intl)
start-dev.bat      Chạy cả hai ứng dụng ở chế độ development
start-prod.bat     Build và chạy cả hai ứng dụng ở chế độ production
```

Hai ứng dụng là hai dự án pnpm độc lập, mỗi bên có lockfile riêng. Không có `package.json` ở thư mục gốc.

## Đóng góp

Rất hoan nghênh đóng góp. Vui lòng đọc [CONTRIBUTING.md](CONTRIBUTING.md) (tiếng Anh) và [Bộ quy tắc ứng xử](CODE_OF_CONDUCT.md).

- Báo lỗi và đề xuất tính năng: [GitHub Issues](https://github.com/LienThuan04/PkgSteward/issues)
- Lỗ hổng bảo mật: **không mở issue công khai**, xem [SECURITY.md](SECURITY.md)

## Giấy phép

[MIT](LICENSE) © 2026 LianHarman (LienThuan04)

## Thương hiệu

PkgSteward là dự án độc lập, không liên kết, không được bảo trợ hay tài trợ bởi npm, Inc. / GitHub, OpenJS
Foundation (Node.js), dự án pnpm hay Yarn, Vercel (Next.js) hoặc Pinterest, Inc. Tên sản phẩm chỉ được dùng để mô tả
khả năng tương thích. Theme mặc định của frontend lấy cảm hứng từ ngôn ngữ thiết kế công khai của Pinterest;
dự án không dùng logo hay font của Pinterest.
