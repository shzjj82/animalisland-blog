import type { Category } from "@myblog/shared";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type TypeChipsProps = {
  className?: string;
  categories: Category[];
} & (
  | { includeAll?: false; value: string; onChange: (value: string) => void }
  | { includeAll: true; value: string | "all"; onChange: (value: string | "all") => void }
);

export function TypeChips(props: TypeChipsProps) {
  const { value, className, categories } = props;

  const select = (next: string | "all") => {
    if (props.includeAll) {
      props.onChange(next);
      return;
    }
    if (next !== "all") {
      props.onChange(next);
    }
  };

  return (
    <div
      className={cn(
        "inline-grid max-w-full grid-flow-col items-stretch gap-2 [grid-auto-columns:minmax(0,1fr)]",
        className,
      )}
      role="radiogroup"
      aria-label="文章分类"
    >
      {props.includeAll ? (
        <Button
          type="button"
          size="sm"
          variant={value === "all" ? "default" : "outline"}
          className="min-w-0 justify-center px-3"
          onClick={() => select("all")}
        >
          <span className="truncate">全部</span>
        </Button>
      ) : null}
      {categories.map((item) => (
        <Button
          key={item.id}
          type="button"
          size="sm"
          variant={value === item.slug ? "default" : "outline"}
          className="min-w-0 justify-center px-3"
          onClick={() => select(item.slug)}
        >
          <span className="truncate">{item.name}</span>
        </Button>
      ))}
    </div>
  );
}
