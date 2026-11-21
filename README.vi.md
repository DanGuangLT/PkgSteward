<p align="center"><img src=".github/assets/logo.svg" alt="Logo PkgSteward" width="120" height="120"></p>

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
- **An toàn là trên hết:** mọi thao tác xoá hoặc ảnh hưởng toàn máy đều đi qua bước *xem trước → xác nhận*; lệnh
  dự án bên dưới chạy ngay sau một cú nhấp bên cạnh cảnh báo tin cậy cố định.
- **Lệnh dự án:** chạy cài/cập nhật/gỡ gói hoặc một script khai báo sẵn từ trang chi tiết dự án bằng npm 10–12
  hoặc pnpm 10–12 trong cửa sổ console Windows **CMD** hoặc **PowerShell** riêng biệt (mặc định `cmd`, cửa sổ vẫn mở
  sau khi lệnh đầu kết thúc cho tới khi bạn đóng hoặc nhấn **Dừng**; package con trong workspace chỉ chạy được script).
  Nếu phiên trước chưa đóng sạch hoặc backend bị tắt đột ngột, **khoá khôi phục (recovery hold)** sẽ chặn thao tác
  mới cho tới khi bạn xác nhận dọn tiến trình và gỡ khoá.

## Gói global

Quản lý gói global bằng npm 10/11/12 hoặc pnpm 10/11/12 qua bước **xem trước → xác nhận**.
Cần thiết lập pnpm global trước: chạy `pnpm setup` trong terminal, bảo đảm `PNPM_HOME` (hoặc thư mục lệnh
global đã cấu hình) có trong PATH, mở terminal mới rồi khởi động lại PkgSteward.

pnpm 10 giữ mọi gói global trong một dự án dùng chung. Đổi phiên bản hoặc xoá một gói sẽ chạy lại pnpm trên
dự án đó. Bản xem trước liệt kê các gói khác; sau thao tác, PkgSteward kiểm tra chúng vẫn giữ nguyên.
Nếu kiểm tra thất bại, kết quả không thể xác minh: hãy làm mới danh sách và kiểm tra các gói trước thao tác tiếp theo.
Ứng dụng không tự thử lại hay hoàn tác. Các gói cài bằng `link:`, file, git, tarball và alias chỉ được hiển thị,
không thể sửa tại đây. Phiên bản gói cũ có thể còn trên đĩa đến khi pnpm dọn chúng. Chỉ thay đổi gói bạn tin cậy:
script vòng đời và mã phụ thuộc có thể ảnh hưởng toàn máy với quyền của bạn, không có môi trường cô lập.
Xem [Gói global](apps/web/README.md#global-packages) để biết đầy đủ quy trình và giới hạn (tiếng Anh).

## Yêu cầu

- Windows 11
- Node.js 22.18 trở lên (đã kiểm trên Node 22 và 24; phát triển dùng Node 24, xem [`.nvmrc`](.nvmrc)). Node cũ hơn sẽ in cảnh báo khi khởi động và có thể không chạy được.
- pnpm 11 (khuyên dùng), pnpm 10, npm hoặc Yarn 1

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

Khi cài mới bằng Yarn Classic (`1.22.22`), dùng bản Node.js 24 mới để đáp ứng yêu cầu của các dependency
được tải về. Chạy `yarn install` ở thư mục gốc, sau đó chạy `yarn build` và `yarn start`, hoặc dùng
`yarn dev` khi phát triển.

Dùng `yarn install --offline` tại thư mục gốc để cài cả hai ứng dụng từ bộ nhớ đệm của Yarn.

Sau khi cài bằng Yarn, chạy các bộ kiểm thử từ thư mục gốc:

```bash
yarn --cwd apps/web test                  # kiểm thử đơn vị frontend
yarn --cwd apps/api test --runInBand       # kiểm thử đơn vị backend
yarn --cwd apps/api test:e2e --runInBand   # kiểm thử HTTP đầu cuối của backend
```

PkgSteward nhận diện dự án Yarn và đọc lockfile Yarn Classic để phân tích dependency. Trình chạy lệnh
trong ứng dụng dùng npm và pnpm, còn `NPM_COMMAND_TIMEOUT_MS` áp dụng cho thao tác do ứng dụng khởi chạy.

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
| `NPM_COMMAND_TIMEOUT_MS` | (trống) | Không giới hạn thời gian; đặt số mili giây (tối thiểu `1000`) để dừng lệnh npm hoặc pnpm sau khoảng đó |

Giá trị trong settings.json ở thư mục dữ liệu ghi đè biến môi trường.

Biến của frontend đặt trong `apps/web/.env.local` hoặc `apps/web/.env` (sao chép từ `.env.example` của frontend):

| Biến | Mặc định khi trống hoặc không đặt | Ý nghĩa |
|---|---|---|
| `PORT` | `24680` | Cổng lắng nghe của frontend; số nguyên thập phân từ `1` đến `65535` |
| `HOST` | `127.0.0.1` | Địa chỉ lắng nghe của frontend; chỉ `127.0.0.1`, `localhost` hoặc `::1` |
| `API_BASE_URL` | `http://127.0.0.1:24681/api/v1` | URL backend, chỉ đọc phía server, gồm cả tiền tố và phiên bản API |

Với `PORT`/`HOST` của frontend, giá trị không rỗng đầu tiên được dùng: biến môi trường thật → `.env.local` → `.env` → mặc định.
Giá trị chỉ có khoảng trắng tính là rỗng; giá trị sai sẽ dừng khởi động. Đổi `PORT` hoặc `HOST` của frontend thì sửa
`LIST_ORIGIN_CORS` của backend cho khớp origin mở trên trình duyệt (ví dụ `http://localhost:24680`). Cập nhật
`API_BASE_URL` của frontend khi đổi `HOST`, `PORT`, `GLOBAL_PREFIX` hoặc `VERSION` của backend. Ví dụ, với
`GLOBAL_PREFIX=steward` và `VERSION=2` trên địa chỉ mặc định, đặt `API_BASE_URL=http://127.0.0.1:24681/steward/v2`
trong `apps/web/.env.local`.

> [!IMPORTANT]
> API không có xác thực theo thiết kế. Giữ `HOST` là địa chỉ loopback (mặc định `127.0.0.1`), không mở API ra mạng.

### 3. Chạy

Chạy cả hai ứng dụng từ thư mục gốc, bằng trình quản lý gói bạn đã dùng để cài:

```bash
pnpm dev        # hoặc: npm run dev / yarn dev
```

Sau khi kéo bản cập nhật, các lệnh `dev`, `build` và `start` ở thư mục gốc kiểm tra các gói đã khai báo
trong từng ứng dụng, gồm cả gói dùng khi phát triển. Nếu thiếu gói, lệnh chạy `install` trong ứng dụng đó
bằng cùng trình quản lý gói. Nếu cài thất bại, lệnh nêu tên ứng dụng gặp lỗi và dừng trước khi khởi chạy ứng dụng nào.
Dùng bước cài đặt ở trên cho lần đầu hoặc khi cần cập nhật phiên bản gói theo lockfile mới.

Hai ứng dụng chạy chung một terminal (`apps/api` khởi động trước, sau khi backend sẵn sàng mới chạy `apps/web`; mỗi dòng log bắt đầu bằng `[api]` hoặc `[web]`). Nhấn `Ctrl+C` để dừng cả hai.
Nếu một ứng dụng dừng (ví dụ vì giá trị trong `.env` không hợp lệ), ứng dụng còn lại cũng được dừng theo (hoặc `apps/web` sẽ không được khởi động nếu `apps/api` lỗi lúc khởi chạy).

Lệnh `dev` và `start` ở thư mục gốc chờ tối đa hai phút để mỗi ứng dụng báo sẵn sàng. Khi hết thời gian, lệnh nêu tên ứng dụng chưa sẵn sàng, dừng các ứng dụng đã khởi chạy và thoát với mã lỗi. Đặt `PKGSTEWARD_STARTUP_TIMEOUT_MS` bằng một số nguyên dương tính theo mili giây để đổi giới hạn.

Muốn chạy production: đặt `MODE=production` trong `apps/api/.env` (tắt Swagger), rồi chạy ở thư mục gốc:

```bash
pnpm build      # hoặc: npm run build / yarn build (build apps/api rồi đến apps/web)
pnpm start      # hoặc: npm start / yarn start (chạy start:prod trong apps/api trước rồi đến start trong apps/web)
```

`start` tự mở giao diện web trong trình duyệt mặc định khi cả hai ứng dụng đã sẵn sàng (mỗi lần chạy mở một tab;
`dev` không mở). Đặt `PKGSTEWARD_NO_BROWSER=1` để bỏ qua. Trong PowerShell, chạy `$env:PKGSTEWARD_NO_BROWSER = "1"` trước `pnpm start`. Biến này có hiệu lực trong phiên PowerShell hiện tại. Chạy `Remove-Item Env:PKGSTEWARD_NO_BROWSER` để bật lại chế độ tự mở trình duyệt.

Bạn vẫn có thể chạy riêng từng ứng dụng trong thư mục của nó, ví dụ `cd apps/api && pnpm dev`.

| | URL |
|---|---|
| Giao diện web | http://localhost:24680 |
| API | http://localhost:24681/api/v1 |
| Swagger (chỉ development) | http://localhost:24681/swagger |

Lệnh ở thư mục gốc chạy cả hai ứng dụng; các lệnh còn lại trong bảng chạy trong thư mục của ứng dụng đó. Với npm, dùng
`npm run <lệnh>`; với Yarn, dùng `yarn <lệnh>`.

## Lệnh

Dùng bản Node.js 24 mới để chạy bộ kiểm thử Jest của backend (`test` và `test:e2e`). Backend chạy
được trên Node.js 22.18 trở lên.

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
| | `pnpm test` | Chạy kiểm thử đơn vị frontend bằng Node.js |
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
Foundation (Node.js), dự án pnpm hay Yarn, hoặc Vercel (Next.js). Tên sản phẩm chỉ được dùng để mô tả khả năng tương
thích. Frontend không dùng logo hay font thương hiệu của bên thứ ba.
