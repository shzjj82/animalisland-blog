import { useRef, useState, type ChangeEvent, type DragEvent } from "react";

type FilePickProps = {
  label: string;
  hint?: string;
  fileName?: string;
  previewUrl?: string;
  compact?: boolean;
  accept?: string;
  multiple?: boolean;
  onFile: (file: File) => void;
  onFiles?: (files: File[]) => void;
};

export function FilePick({
  label,
  hint,
  fileName,
  previewUrl,
  compact,
  accept = "image/*",
  multiple,
  onFile,
  onFiles,
}: FilePickProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  const take = (list: FileList | File[] | null | undefined) => {
    const files = list ? Array.from(list) : [];
    if (!files.length) {
      return;
    }
    if (onFiles) {
      onFiles(files);
    } else {
      onFile(files[0]);
    }
    if (inputRef.current) {
      inputRef.current.value = "";
    }
  };

  const onChange = (e: ChangeEvent<HTMLInputElement>) => {
    take(e.target.files);
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    take(e.dataTransfer.files);
  };

  return (
    <div className={`file-pick${compact ? " file-pick--compact" : ""}`}>
      <input
        ref={inputRef}
        className="file-pick-input"
        type="file"
        accept={accept}
        multiple={multiple}
        onChange={onChange}
      />
      <button
        type="button"
        className={`file-pick-btn${over ? " is-over" : ""}${previewUrl ? " has-preview" : ""}`}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
      >
        {previewUrl && !compact ? (
          <img src={previewUrl} alt="" className="file-pick-preview" />
        ) : null}
        <span className="file-pick-copy">
          <strong>{label}</strong>
          <em>{fileName || hint || "也可以把文件拖进来"}</em>
        </span>
      </button>
    </div>
  );
}
