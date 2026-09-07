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
      className={cn("flex flex-wrap items-center gap-2", className)}
      role="radiogroup"
      aria-label="文章类型"
    >
      {props.includeAll ? (
        <Button
          type="button"
          size="sm"
          variant={value === "all" ? "default" : "outline"}
          onClick={() => select("all")}
        >
          全部
        </Button>
      ) : null}
      {categories.map((item) => (
        <Button
          key={item.id}
          type="button"
          size="sm"
          variant={value === item.slug ? "default" : "outline"}
          onClick={() => select(item.slug)}
        >
          {item.name}
        </Button>
      ))}
    </div>
  );
}
