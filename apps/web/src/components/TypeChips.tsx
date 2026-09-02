import { ARTICLE_TYPES, POST_TYPE_LABEL, type ArticleType } from "@myblog/shared";
import { Button } from "animal-island-ui";

type TypeChipsProps = {
  className?: string;
} & (
  | { includeAll?: false; value: ArticleType; onChange: (value: ArticleType) => void }
  | { includeAll: true; value: ArticleType | "all"; onChange: (value: ArticleType | "all") => void }
);

export function TypeChips(props: TypeChipsProps) {
  const { value, className } = props;

  const select = (next: ArticleType | "all") => {
    if (props.includeAll) {
      props.onChange(next);
      return;
    }
    if (next !== "all") {
      props.onChange(next);
    }
  };

  return (
    <div className={["type-row", className].filter(Boolean).join(" ")} role="radiogroup" aria-label="文章类型">
      {props.includeAll ? (
        <Button
          size="small"
          type={value === "all" ? "primary" : "default"}
          htmlType="button"
          className={value === "all" ? "type-chip is-on" : "type-chip"}
          onClick={() => select("all")}
        >
          全部
        </Button>
      ) : null}
      {ARTICLE_TYPES.map((item) => (
        <Button
          key={item}
          size="small"
          type={value === item ? "primary" : "default"}
          htmlType="button"
          className={value === item ? "type-chip is-on" : "type-chip"}
          onClick={() => select(item)}
        >
          {POST_TYPE_LABEL[item]}
        </Button>
      ))}
    </div>
  );
}
