# Manager NPM

**Ứng dụng web chạy local để quét, phân tích và quản lý các dự án Node.js / npm trên máy Windows của bạn.**

[![CI](https://github.com/LienThuan04/Manager-NPM/actions/workflows/ci.yml/badge.svg)](https://github.com/LienThuan04/Manager-NPM/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

[English](README.md) · Tiếng Việt

> [!WARNING]
> **Đang trong giai đoạn phát triển sớm.** Phần nền của backend và frontend đã xong, nhưng các module tính năng
> (quét, phân tích, dọn dẹp, quản lý phiên bản) **mới ở dạng kế hoạch**, chưa được cài đặt.
> Xem [Lộ trình](#lộ-trình).

## Giới thiệu

Manager NPM chạy hoàn toàn trên máy của bạn: một API NestJS (cổng `8080`) và giao diện Next.js (cổng `3000`).
Mục tiêu là trả lời các câu hỏi như *"máy mình có những dự án nào, chúng phụ thuộc gì, gói nào đã cũ, `node_modules`
chiếm bao nhiêu dung lượng?"* và làm các việc thường gặp (cài/cập nhật package, xoá `node_modules`, đổi phiên bản
package manager hoặc Node.js) một cách an toàn.

- **Chạy local, một người dùng:** không tài khoản, không xác thực, không database. Dữ liệu được đọc trực tiếp từ
  filesystem tại thời điểm gọi API.
- **An toàn là trên hết:** mọi thao tác xoá hoặc ảnh hưởng toàn máy đều đi qua bước *xem trước → xác nhận*.

## Trạng thái

| Khu vực | Trạng thái |
|---|---|
| Nền backend: NestJS 11, kiểm tra biến môi trường, exception filter toàn cục, interceptor response/logging, phân trang, Swagger, giới hạn tần suất request, test | ✅ Xong |
| Nền frontend: Next.js 16 + React 19, Tailwind CSS v4, component shadcn/ui, theme sáng/tối/hệ thống, đa ngôn ngữ (Anh/Việt), khung giao diện | ✅ Xong |
| Trang trình bày design system (`/design-system`) | 🚧 Đang làm |
| Các module tính năng (xem Lộ trình) | 📋 Kế hoạch |

## Lộ trình

| # | Module | Chức năng dự kiến | An toàn |
|---|---|---|---|
| 4.1 | Scanner | Tìm dự án Node.js (`package.json`) trong các thư mục gốc đã cấu hình | Chỉ đọc |
| 4.2 | Projects | Phân tích 1 dự án: dependencies, gói lỗi thời, lỗ hổng | Chỉ đọc |
| 4.3 | npm runner | Chạy `install` / `update` / `uninstall` / script trong dự án, hiển thị output trực tiếp | Giới hạn trong dự án |
| 4.4 | Thao tác file | Cây thư mục có checkbox; xoá `node_modules`, file, thư mục hoặc cả dự án | Xem trước → xác nhận |
| 4.5 | Dung lượng | Dung lượng thư mục và từng package trong `node_modules` | Chỉ đọc, có cache |
| 4.6 | Package global | Xem, cập nhật, xoá package cài global (npm / pnpm / Yarn) | Xem trước → xác nhận |
| 4.7 | Phiên bản package manager | Quản lý phiên bản npm / pnpm / Yarn theo dự án hoặc global (Corepack) | Xem trước → xác nhận |
| 4.8 | Phiên bản Node.js | Đổi phiên bản Node.js đang dùng qua nvm-windows | Xem trước → xác nhận (ảnh hưởng toàn máy) |

Tất cả module đều **đang ở dạng kế hoạch**.

## Nguyên tắc an toàn

Đây là một phần của thiết kế. Mọi module thay đổi file hoặc môi trường đều phải tuân theo:

- **Xem trước → xác nhận:** module có endpoint `preview` liệt kê chính xác những gì sẽ xảy ra và endpoint `execute`
  chỉ chạy khi được xác nhận rõ ràng. Giao diện luôn hiển thị bản xem trước trước.
- **Danh sách path cho phép:** mọi path từ client đều được resolve (kể cả symlink / junction) và phải nằm trong
  `SCAN_ROOT_PATHS`.
- **Không ghép chuỗi lệnh shell:** lệnh ngoài chạy bằng `execa` với mảng tham số và có timeout.
- **Chỉ dùng trên máy local:** API không có xác thực theo thiết kế. Giữ `HOST=localhost`, không mở ra mạng.

## Yêu cầu

- **Hệ điều hành:** ưu tiên Windows 11. Có thể phát triển trên hệ điều hành khác, nhưng một số tính năng dự kiến
  (tích hợp nvm-windows) chỉ dành cho Windows.
- **Node.js 24** (xem [`.nvmrc`](.nvmrc))
- **pnpm 11** (package manager duy nhất được hỗ trợ)

## Bắt đầu nhanh

```bash
git clone https://github.com/LienThuan04/Manager-NPM.git
cd Manager-NPM

# Backend: http://localhost:8080/api/v1 (Swagger: http://localhost:8080/swagger)
cd manager_npm_be
pnpm install
cp .env.example .env      # sau đó điền SCAN_ROOT_PATHS
pnpm dev

# Frontend: http://localhost:3000 (mở terminal thứ hai)
cd manager_npm_fe
pnpm install
pnpm dev
```

Hai ứng dụng là hai dự án pnpm độc lập, mỗi bên có lockfile riêng. Không có `package.json` ở thư mục gốc.

### Cấu hình backend

Sao chép `manager_npm_be/.env.example` thành `.env`. Các biến chính:

| Biến | Mặc định | Ý nghĩa |
|---|---|---|
| `MODE` | `development` | `development` bật Swagger |
| `HOST`, `PORT` | `localhost`, `8080` | Địa chỉ lắng nghe |
| `GLOBAL_PREFIX`, `VERSION` | `api`, `1` | Tiền tố URL, ví dụ `/api/v1` |
| `LIST_ORIGIN_CORS` | `http://localhost:3000` | Origin của frontend được CORS cho phép |
| `SCAN_ROOT_PATHS` | *(trống)* | Các thư mục gốc để quét, phân cách bằng dấu phẩy; đồng thời là danh sách path cho phép |
| `MAX_SCAN_DEPTH` | `4` | Độ sâu tối đa khi quét |
| `NPM_COMMAND_TIMEOUT_MS` | `120000` | Timeout khi chạy lệnh npm / pnpm / Yarn |

## Lệnh

| Ứng dụng | Lệnh | Việc |
|---|---|---|
| Backend | `pnpm dev` | Chạy ở chế độ watch |
| | `pnpm lint` | ESLint (tự sửa) |
| | `pnpm build` | Biên dịch ra `dist/` |
| | `pnpm test` / `pnpm test:e2e` | Unit test / e2e test (Jest) |
| Frontend | `pnpm dev` | Chạy dev server Next.js |
| | `pnpm lint` | ESLint |
| | `pnpm build` | Build production |
| | `pnpm theme:check` | Kiểm tra độ tương phản WCAG AA của theme |
| | `pnpm i18n:check` | Kiểm tra `messages/en.json` và `messages/vi.json` có cùng bộ key |

## Cấu trúc thư mục

```
manager_npm_be/        API NestJS (src/common, src/config, src/core; module tính năng sẽ thêm sau)
manager_npm_fe/        Giao diện Next.js (app/, components/, i18n/, messages/, styles/, lib/)
```

## Đóng góp

Rất hoan nghênh đóng góp. Vui lòng đọc [CONTRIBUTING.md](CONTRIBUTING.md) (tiếng Anh) và [Bộ quy tắc ứng xử](CODE_OF_CONDUCT.md).

- Báo lỗi và đề xuất tính năng: [GitHub Issues](https://github.com/LienThuan04/Manager-NPM/issues)
- Lỗ hổng bảo mật: **không mở issue công khai**, xem [SECURITY.md](SECURITY.md)

## Giấy phép

[MIT](LICENSE) © 2026 LianHarman (LienThuan04)

## Thương hiệu

Manager NPM là dự án độc lập, không liên kết, không được bảo trợ hay tài trợ bởi npm, Inc. / GitHub, OpenJS
Foundation (Node.js), dự án pnpm hay Yarn, Vercel (Next.js) hoặc Pinterest, Inc. Tên sản phẩm chỉ được dùng để mô tả
khả năng tương thích. Theme mặc định của frontend lấy cảm hứng từ ngôn ngữ thiết kế công khai của Pinterest;
dự án không dùng logo hay font của Pinterest.
