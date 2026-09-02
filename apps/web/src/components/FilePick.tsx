import { useRef, useState, type ChangeEvent, type DragEvent } from "react";

type FilePickProps = {
  label: string;
  hint?: string;
  fileName?: string;
  previewUrl?: string;
  compact?: boolean;
  onFile: (file: File) => void;
};

export function FilePick({ label, hint, fileName, previewUrl, compact, onFile }: FilePickProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  const take = (file: File | undefined) => {
    if (file) {
      onFile(file);
    }
    if (inputRef.current) {
      inputRef.current.value = "";
    }
  };

  const onChange = (e: ChangeEvent<HTMLInputElement>) => {
    take(e.target.files?.[0]);
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    take(e.dataTransfer.files[0]);
  };

  return (
    <div className={`file-pick${compact ? " file-pick--compact" : ""}`}>
      <input
        ref={inputRef}
        className="file-pick-input"
        type="file"
        accept="image/*"
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
          <em>{fileName || hint || "也可以把图片拖进来"}</em>
        </span>
      </button>
    </div>
  );
}
