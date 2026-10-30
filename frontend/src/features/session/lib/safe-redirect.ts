/** Login sahifasidan qaytish manzili: faqat ilova ichidagi nisbiy yo'l (open redirect yo'q). */
export function safeRedirect(value: string | null): string {
  return value && value.startsWith('/') && !value.startsWith('//') && !value.startsWith('/login')
    ? value
    : '/';
}
