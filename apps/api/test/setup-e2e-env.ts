import { tmpdir } from 'os';
import { join } from 'path';

// e2e không được đọc settings.json thật trong %LOCALAPPDATA%\PkgSteward: trỏ dataDir sang
// thư mục tạm (không tạo — không có file thì settings = {}). process.env thắng .env.
process.env.PKGSTEWARD_DATA_DIR = join(
  tmpdir(),
  `pkgsteward-e2e-${process.pid}`,
);
process.env.MODE = 'development';
process.env.LIST_ORIGIN_CORS = 'http://localhost:24680';
