"use client";

import { useLayoutEffect, useRef, type InputHTMLAttributes } from "react";
import { formatAmountTyping } from "@/utils/paymentRequest";

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type" | "inputMode"> & {
  value: string;
  onChange: (value: string) => void;
};

/**
 * Ô nhập số tiền tự chia nhóm nghìn khi gõ ("192802100" → "192.802.100", phần lẻ sau dấu phẩy, tối đa 2 số) để người dùng
 * đọc được số tiền đang nhập. Giá trị trả ra là chữ đã định dạng — đọc bằng parseAmountLoose. Con trỏ giữ đúng chỗ khi ô
 * chèn / bỏ dấu chấm (sửa giữa số không bị nhảy về cuối).
 */
export default function AmountInput({ value, onChange, ...rest }: Props) {
  const ref = useRef<HTMLInputElement>(null);
  const caret = useRef<number | null>(null);

  useLayoutEffect(() => {
    const input = ref.current;
    const position = caret.current;
    caret.current = null;
    if (input && position !== null && document.activeElement === input) input.setSelectionRange(position, position);
  }, [value]);

  return (
    <input
      {...rest}
      ref={ref}
      type="text"
      inputMode="decimal"
      autoComplete="off"
      value={value}
      onChange={(event) => {
        const { value: next, selectionStart } = event.target;
        const formatted = formatAmountTyping(next, value, selectionStart ?? next.length);
        caret.current = formatted.text === value ? null : formatted.caret;
        onChange(formatted.text);
      }}
    />
  );
}
