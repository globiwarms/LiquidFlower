//! Captures a screen region through GDI and returns a downscaled JPEG data URL.
//! Used to give the petals real "Liquid Glass" — they blur what is actually
//! behind them.

use base64::Engine;
use windows::Win32::Graphics::Gdi::{
    BitBlt, CreateCompatibleDC, CreateDIBSection, DeleteDC, DeleteObject, GetDC, ReleaseDC,
    SelectObject, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS, HBITMAP, SRCCOPY,
};

/// Returns `data:image/jpeg;base64,...` for the given physical-pixel region.
pub fn capture_region(x: i32, y: i32, w: i32, h: i32) -> Option<String> {
    if w <= 0 || h <= 0 {
        return None;
    }
    unsafe {
        let hdc = GetDC(None);
        if hdc.is_invalid() {
            return None;
        }
        let mem = CreateCompatibleDC(Some(hdc));

        let mut bmi = BITMAPINFO::default();
        bmi.bmiHeader.biSize = std::mem::size_of::<BITMAPINFOHEADER>() as u32;
        bmi.bmiHeader.biWidth = w;
        bmi.bmiHeader.biHeight = -h; // top-down
        bmi.bmiHeader.biPlanes = 1;
        bmi.bmiHeader.biBitCount = 32;
        bmi.bmiHeader.biCompression = BI_RGB.0;

        let mut bits: *mut std::ffi::c_void = std::ptr::null_mut();
        let hbmp: HBITMAP = match CreateDIBSection(Some(mem), &bmi, DIB_RGB_COLORS, &mut bits, None, 0) {
            Ok(h) if !h.is_invalid() && !bits.is_null() => h,
            _ => {
                let _ = DeleteDC(mem);
                let _ = ReleaseDC(None, hdc);
                return None;
            }
        };

        let old = SelectObject(mem, hbmp.into());
        let _ = BitBlt(mem, 0, 0, w, h, Some(hdc), x, y, SRCCOPY);

        let len = (w as usize) * (h as usize) * 4;
        let slice = std::slice::from_raw_parts(bits as *const u8, len);
        let mut rgba = slice.to_vec();
        for px in rgba.chunks_exact_mut(4) {
            px.swap(0, 2); // BGRA -> RGBA
            px[3] = 255;
        }
        SelectObject(mem, old);
        let _ = DeleteObject(hbmp.into());
        let _ = DeleteDC(mem);
        let _ = ReleaseDC(None, hdc);

        let img = image::RgbaImage::from_raw(w as u32, h as u32, rgba)?;
        // Downscale x2 — the petals blur it anyway, keeps IPC payload small.
        let (w2, h2) = ((w as u32 / 2).max(1), (h as u32 / 2).max(1));
        let small = image::imageops::resize(&img, w2, h2, image::imageops::FilterType::Triangle);
        // JPEG has no alpha — encode opaque RGB.
        let rgb = image::DynamicImage::ImageRgba8(small).to_rgb8();

        let mut jpg = std::io::Cursor::new(Vec::new());
        let enc = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut jpg, 80);
        rgb.write_with_encoder(enc).ok()?;
        let b64 = base64::engine::general_purpose::STANDARD.encode(jpg.into_inner());
        Some(format!("data:image/jpeg;base64,{b64}"))
    }
}
