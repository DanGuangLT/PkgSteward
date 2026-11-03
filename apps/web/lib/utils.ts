import { createCn } from "cn/config"

/**
 * cn() dùng chung cho toàn app — mọi component import từ "@/lib/utils",
 * không import thẳng từ gói "cn" (ESLint chặn).
 *
 * Đăng ký các token tự định nghĩa trong styles/tokens.css để cn() hiểu
 * `text-heading-xl` là cỡ chữ (không phải màu chữ) và `shadow-modal` là bóng
 * (không phải màu bóng). Thêm token cỡ chữ / bóng mới → thêm tên vào đây.
 */
export const cn = createCn({
  extend: {
    theme: {
      text: [
        "heading-xl",
        "heading-lg",
        "heading-md",
        "body-md",
        "body-sm",
        "caption",
        "button",
        "button-sm",
      ],
      shadow: ["modal"],
    },
  },
})
