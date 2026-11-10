# PkgSteward

**Ứng dụng web chạy local để quét, phân tích và quản lý các dự án Node.js / npm trên máy Windows của bạn.**

[![CI](https://github.com/LienThuan04/PkgSteward/actions/workflows/ci.yml/badge.svg)](https://github.com/LienThuan04/PkgSteward/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

[English](README.md) · Tiếng Việt

## Giới thiệu

PkgSteward chạy hoàn toàn trên máy của bạn: một API NestJS và giao diện web Next.js. Mục tiêu là trả lời các câu hỏi
như *"máy mình có những dự án nào, chúng phụ thuộc gì, gói nào đã cũ, `node_modules` chiếm bao nhiêu dung lượng?"*
và làm các việc thường gặp (cài/cập nhật package, xoá `node_modules`, ghim phiên bản package manager cho
từng dự án) một cách an toàn.

- **Chạy local, một người dùng:** không tài khoản, không xác thực, không database. Dữ liệu được đọc trực tiếp từ
  filesystem tại thời điểm gọi API.
- **An toàn là trên hết:** mọi thao tác xoá hoặc ảnh hưởng toàn máy đều đi qua bước *xem trước → xác nhận*.

## Yêu cầu

- Windows 11
- Node.js 24 (xem [`.nvmrc`](.nvmrc))
- pnpm 11 (khuyên dùng), npm hoặc Yarn 1

## Bắt đầu

### 1. Cài đặt

```bash
git clone https://github.com/LienThuan04/PkgSteward.git
cd PkgSteward

# Chạy một trong các lệnh sau ở thư mục gốc; lệnh sẽ cài cả apps/api và apps/web cho từng trình quản lý gói mà bạn dùng (chỉ chạy 1 trong 3 lệnh sau):
pnpm install
npm install
yarn install
```

Lệnh cài ở thư mục gốc chạy cùng trình quản lý gói đó bên trong `apps/api` và `apps/web`. Chỉ pnpm đọc
các file `pnpm-lock.yaml` có sẵn trong repo, nơi ghi đúng phiên bản đã kiểm thử. npm và Yarn sẽ lấy phiên
bản mới nhất mà từng `package.json` cho phép, và lockfile do chúng tạo ra không được commit.

### 2. Cấu hình

Sao chép `apps/api/.env.example` thành `apps/api/.env` rồi điền `SCAN_ROOT_PATHS`. Các biến chính:

| Biến | Mặc định | Ý nghĩa |
|---|---|---|
| `MODE` | `development` | `development` bật Swagger |
| `HOST`, `PORT` | `127.0.0.1`, `24681` | Địa chỉ lắng nghe; `HOST` chỉ nhận địa chỉ loopback (`127.0.0.1`, `localhost` hoặc `::1`) |
| `GLOBAL_PREFIX`, `VERSION` | `api`, `1` | Tiền tố URL, ví dụ `/api/v1` |
| `LIST_ORIGIN_CORS` | `http://localhost:24680` | Origin của frontend được CORS cho phép |
| `SCAN_ROOT_PATHS` | `*` | Các thư mục gốc (đường dẫn tuyệt đối, VD `D:\Projects`) để quét, phân cách bằng dấu phẩy, hoặc `*` (hay để trống) để quét mọi ổ đĩa cố định; `*` phải đứng một mình. Đồng thời là danh sách path cho phép (thư mục hệ thống luôn bị loại) |
| `MAX_SCAN_DEPTH` | `0` | Độ sâu tối đa khi quét, tính từ mỗi thư mục gốc (từ gốc mỗi ổ đĩa khi dùng `*`); `0` là không giới hạn |
| `SCAN_TIMEOUT_MS` | (trống) | Không giới hạn thời gian; đặt số mili giây (tối thiểu `1000`) để dừng lần quét sau khoảng đó |
| `PKGSTEWARD_DATA_DIR` | `PkgStewardLog` | Thư mục dữ liệu runtime (log, cache, `settings.json`): đường dẫn tuyệt đối, hoặc tương đối tính từ thư mục gốc dự án. Mặc định là thư mục `PkgStewardLog` trong thư mục dự án |
| `NPM_COMMAND_TIMEOUT_MS` | (trống) | Không giới hạn thời gian; đặt số mili giây (tối thiểu `1000`) để dừng lệnh npm / pnpm / Yarn sau khoảng đó |

Giá trị trong settings.json ở thư mục dữ liệu ghi đè biến môi trường.

Biến của frontend đặt trong `apps/web/.env.local` hoặc `apps/web/.env` (sao chép từ `.env.example` của frontend):

| Biến | Mặc định khi trống hoặc không đặt | Ý nghĩa |
|---|---|---|
| `PORT` | `24680` | Cổng lắng nghe của frontend; số nguyên thập phân từ `1` đến `65535` |
| `HOST` | `127.0.0.1` | Địa chỉ lắng nghe của frontend; chỉ `127.0.0.1`, `localhost` hoặc `::1` |
| `API_BASE_URL` | `http://127.0.0.1:24681/api/v1` | URL backend, chỉ đọc phía server; phải khớp địa chỉ backend |

Với `PORT`/`HOST` của frontend, giá trị không rỗng đầu tiên được dùng: biến môi trường thật → `.env.local` → `.env` → mặc định.
Giá trị chỉ có khoảng trắng tính là rỗng; giá trị sai sẽ dừng khởi động. Đổi `PORT` hoặc `HOST` của frontend thì sửa
`LIST_ORIGIN_CORS` của backend cho khớp origin mở trên trình duyệt (ví dụ `http://localhost:24680`). Đổi `PORT` hoặc
`HOST` của backend thì sửa `API_BASE_URL` của frontend.

> [!IMPORTANT]
> API không có xác thực theo thiết kế. Giữ `HOST` là địa chỉ loopback (mặc định `127.0.0.1`), không mở API ra mạng.

### 3. Chạy

Chạy cả hai ứng dụng từ thư mục gốc, bằng trình quản lý gói bạn đã dùng để cài:

```bash
pnpm dev        # hoặc: npm run dev / yarn dev
```

Hai ứng dụng chạy chung một terminal; mỗi dòng log bắt đầu bằng `[api]` hoặc `[web]`. Nhấn `Ctrl+C` để dừng cả hai.
Nếu một ứng dụng dừng (ví dụ vì giá trị trong `.env` không hợp lệ), ứng dụng còn lại cũng được dừng theo.

Muốn chạy production: đặt `MODE=production` trong `apps/api/.env` (tắt Swagger), rồi chạy ở thư mục gốc:

```bash
pnpm build      # hoặc: npm run build / yarn build (build apps/api rồi đến apps/web)
pnpm start      # hoặc: npm start / yarn start (chạy start:prod trong apps/api và start trong apps/web)
```

Bạn vẫn có thể chạy riêng từng ứng dụng trong thư mục của nó, ví dụ `cd apps/api && pnpm dev`.

| | URL |
|---|---|
| Giao diện web | http://localhost:24680 |
| API | http://localhost:24681/api/v1 |
| Swagger (chỉ development) | http://localhost:24681/swagger |

Lệnh ở thư mục gốc chạy cả hai ứng dụng; các lệnh còn lại trong bảng chạy trong thư mục của ứng dụng đó. Với npm, dùng
`npm run <lệnh>`; với Yarn, dùng `yarn <lệnh>`.

## Lệnh

| Ứng dụng | Lệnh | Việc |
|---|---|---|
| Thư mục gốc | `pnpm install` | Cài cả hai ứng dụng |
| | `pnpm dev` | Chạy cả hai ứng dụng ở chế độ development |
| | `pnpm build` / `pnpm start` | Build cả hai ứng dụng / chạy cả hai bản build production |
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
apps/api/          API backend (NestJS 12)
apps/web/          Giao diện web (Next.js 16, React 19, Tailwind CSS v4, shadcn/ui, next-intl)
scripts/           Script của repo (cài và chạy từ thư mục gốc, danh sách thư viện bên thứ ba)
package.json       Lệnh ở thư mục gốc: cài, chạy và build cả hai ứng dụng
```

Hai ứng dụng là hai dự án pnpm độc lập, mỗi bên có lockfile riêng. `package.json` ở thư mục gốc không có
dependency nào; nó chỉ cài, chạy và build cả hai ứng dụng bằng đúng trình quản lý gói bạn gọi.

## Đóng góp

Rất hoan nghênh đóng góp. Vui lòng đọc [CONTRIBUTING.md](CONTRIBUTING.md) (tiếng Anh) và [Bộ quy tắc ứng xử](CODE_OF_CONDUCT.md).

- Báo lỗi và đề xuất tính năng: [GitHub Issues](https://github.com/LienThuan04/PkgSteward/issues)
- Lỗ hổng bảo mật: **không mở issue công khai**, xem [SECURITY.md](SECURITY.md)

## Giấy phép

Bản quyền (c) 2026 LianHarman (LienThuan04). Phát hành theo [Giấy phép MIT](LICENSE).

## Giấy phép bên thứ ba

PkgSteward sử dụng các gói mã nguồn mở theo giấy phép riêng của từng gói. Bản quyền của các gói này thuộc về
tác giả tương ứng. Xem danh sách đầy đủ cùng phiên bản và giấy phép trong
[`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md). Mỗi ứng dụng cũng có tệp `LICENSE` riêng.

## Thương hiệu

PkgSteward là dự án độc lập, không liên kết, không được bảo trợ hay tài trợ bởi npm, Inc. / GitHub, OpenJS
Foundation (Node.js), dự án pnpm hay Yarn, Vercel (Next.js) hoặc Pinterest, Inc. Tên sản phẩm chỉ được dùng để mô tả
khả năng tương thích. Theme mặc định của frontend lấy cảm hứng từ ngôn ngữ thiết kế công khai của Pinterest;
dự án không dùng logo hay font của Pinterest.
