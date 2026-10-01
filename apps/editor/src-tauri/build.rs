fn main() {
    tauri_build::try_build(
        tauri_build::Attributes::new().app_manifest(
            tauri_build::AppManifest::new().commands(&[
                "pick_save_path",
                "write_export_file",
                "export_pdf",
            ]),
        ),
    )
    .expect("failed to run tauri-build");
}
