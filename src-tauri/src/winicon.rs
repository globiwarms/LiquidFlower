//! Extracts the icon of an .exe or .lnk (resolved by the shell) as a PNG.

use base64::Engine;
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use windows::core::PCWSTR;
use windows::Win32::Graphics::Gdi::{
    CreateCompatibleDC, DeleteDC, DeleteObject, GetDC, GetDIBits, GetObjectW, ReleaseDC,
    BITMAP, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS,
};
use windows::Win32::System::Com::{CoInitializeEx, COINIT_APARTMENTTHREADED};
use windows::Win32::UI::Controls::{IImageList, ILD_TRANSPARENT};
use windows::Win32::UI::Shell::{
    SHGetFileInfoW, SHGetImageList, SHFILEINFOW, SHGFI_ICON, SHGFI_SYSICONINDEX, SHIL_JUMBO,
};
use windows::Win32::UI::WindowsAndMessaging::{DestroyIcon, GetIconInfo, HICON, ICONINFO};

fn to_wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

/// Extracts the icon and stores it in the cache. Returns a `data:image/png;base64,...`
/// URL or None.
pub fn extract_icon_data_url(path: &str) -> Option<String> {
    let png = load_or_extract(path)?;
    Some(format!("data:image/png;base64,{}", base64::engine::general_purpose::STANDARD.encode(png)))
}

fn icon_cache_path(path: &str) -> std::path::PathBuf {
    let mut h = DefaultHasher::new();
    path.to_lowercase().hash(&mut h);
    crate::config::config_dir()
        .join("icons")
        .join(format!("{:016x}.png", h.finish()))
}

fn load_or_extract(path: &str) -> Option<Vec<u8>> {
    let cache = icon_cache_path(path);
    if let Ok(bytes) = std::fs::read(&cache) {
        return Some(bytes);
    }
    let png = unsafe { extract_png(path) }?;
    if let Some(dir) = cache.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    let _ = std::fs::write(&cache, &png);
    Some(png)
}

unsafe fn dib_to_rgba(hbm: windows::Win32::Graphics::Gdi::HBITMAP) -> Option<(Vec<u8>, i32, i32)> {
    let mut bm = BITMAP::default();
    if GetObjectW(
        hbm.into(),
        std::mem::size_of::<BITMAP>() as i32,
        Some(&mut bm as *mut _ as *mut _),
    ) == 0
    {
        return None;
    }
    let (w, h) = (bm.bmWidth, bm.bmHeight);
    if w <= 0 || h <= 0 {
        return None;
    }

    let mut bmi = BITMAPINFO::default();
    bmi.bmiHeader.biSize = std::mem::size_of::<BITMAPINFOHEADER>() as u32;
    bmi.bmiHeader.biWidth = w;
    bmi.bmiHeader.biHeight = -h;
    bmi.bmiHeader.biPlanes = 1;
    bmi.bmiHeader.biBitCount = 32;
    bmi.bmiHeader.biCompression = BI_RGB.0;

    let mut buf = vec![0u8; (w * h * 4) as usize];
    let hdc = GetDC(None);
    let got = GetDIBits(
        hdc,
        hbm,
        0,
        h as u32,
        Some(buf.as_mut_ptr() as *mut _),
        &mut bmi,
        DIB_RGB_COLORS,
    );
    let _ = ReleaseDC(None, hdc);
    if got == 0 {
        return None;
    }
    for px in buf.chunks_exact_mut(4) {
        px.swap(0, 2); // BGRA -> RGBA
    }
    Some((buf, w, h))
}

unsafe fn extract_png(path: &str) -> Option<Vec<u8>> {
    let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
    let wide = to_wide(path);

    let mut fi = SHFILEINFOW::default();
    let ok = SHGetFileInfoW(
        PCWSTR::from_raw(wide.as_ptr()),
        windows::Win32::Storage::FileSystem::FILE_ATTRIBUTE_NORMAL,
        Some(&mut fi as *mut SHFILEINFOW as *mut _),
        std::mem::size_of::<SHFILEINFOW>() as u32,
        SHGFI_ICON | SHGFI_SYSICONINDEX,
    );
    if ok == 0 || fi.hIcon.is_invalid() {
        return None;
    }
    let shell_icon = fi.hIcon;

    // Prefer the jumbo (256px) system image list variant for a crisp petal icon.
    let mut chosen: HICON = shell_icon;
    let mut chosen_is_shell = true;
    if let Ok(il) = SHGetImageList(SHIL_JUMBO as i32) {
        let il: IImageList = il;
        if let Ok(big) = il.GetIcon(fi.iIcon, ILD_TRANSPARENT.0 as u32) {
            if !big.is_invalid() {
                chosen = big;
                chosen_is_shell = false;
            }
        }
    }

    let mut result = None;
    let mut ii = ICONINFO::default();
    if GetIconInfo(chosen, &mut ii).is_ok() {
        if let Some((mut rgba, w, h)) = dib_to_rgba(ii.hbmColor) {
            // hbmMask is row-padded; rebuild alpha from the mask when the icon
            // carries none in the color bitmap (classic 32px icons).
            if rgba.chunks_exact(4).all(|px| px[3] == 0) && !ii.hbmMask.is_invalid() {
                apply_mask_alpha(&mut rgba, w, h, ii.hbmMask);
            }
            let img = image::RgbaImage::from_raw(w as u32, h as u32, rgba)?;
            let mut png = std::io::Cursor::new(Vec::new());
            img.write_to(&mut png, image::ImageFormat::Png).ok()?;
            result = Some(png.into_inner());
        }
        let _ = DeleteObject(ii.hbmColor.into());
        let _ = DeleteObject(ii.hbmMask.into());
    }

    let _ = DestroyIcon(chosen);
    if chosen_is_shell {
        let _ = DestroyIcon(shell_icon);
    }
    result
}

unsafe fn apply_mask_alpha(rgba: &mut [u8], w: i32, h: i32, hbm_mask: windows::Win32::Graphics::Gdi::HBITMAP) {
    let mut bm = BITMAP::default();
    if GetObjectW(
        hbm_mask.into(),
        std::mem::size_of::<BITMAP>() as i32,
        Some(&mut bm as *mut _ as *mut _),
    ) == 0
    {
        return;
    }
    let row_bytes = ((w + 31) / 32 * 4) as usize;
    let mask_h = (h as usize) * 2; // mask includes AND+XOR planes
    let mut mask = vec![0u8; row_bytes * mask_h];
    let hdc = CreateCompatibleDC(None);
    let got = GetDIBits(
        hdc,
        hbm_mask,
        0,
        mask_h as u32,
        Some(mask.as_mut_ptr() as *mut _),
        &mut {
            let mut bmi = BITMAPINFO::default();
            bmi.bmiHeader.biSize = std::mem::size_of::<BITMAPINFOHEADER>() as u32;
            bmi.bmiHeader.biWidth = w;
            bmi.bmiHeader.biHeight = -(mask_h as i32);
            bmi.bmiHeader.biPlanes = 1;
            bmi.bmiHeader.biBitCount = 1;
            bmi.bmiHeader.biCompression = BI_RGB.0;
            bmi
        },
        DIB_RGB_COLORS,
    );
    let _ = DeleteDC(hdc);
    if got == 0 {
        return;
    }
    for y in 0..h as usize {
        for x in 0..w as usize {
            let byte = mask[y * row_bytes + x / 8];
            if byte & (0x80 >> (x % 8)) != 0 {
                // Mask bit set = transparent pixel.
                rgba[(y * w as usize + x) * 4 + 3] = 0;
            }
        }
    }
}
