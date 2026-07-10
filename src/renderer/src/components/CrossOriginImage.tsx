// <img> with crossOrigin="anonymous" for cross-origin tone thumbnails.
import type { ImgHTMLAttributes } from 'react'

export function CrossOriginImage(props: ImgHTMLAttributes<HTMLImageElement>) {
  return <img {...props} crossOrigin="anonymous" />
}
