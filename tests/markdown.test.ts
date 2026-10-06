import { describe, expect, it } from "vitest";
import { firstLine, plainFirstLine, stripMarkdown } from "@/lib/markdown";

describe("plainFirstLine", () => {
  it("skips headings and rules, then strips inline markdown", () => {
    expect(plainFirstLine("# 为什么看\n\n**长期**看 *AI* 的 `capex` 周期，见 [备忘](http://x)。")).toBe("长期看 AI 的 capex 周期，见 备忘。");
    expect(plainFirstLine("---\n\n- [ ] 等回调到 **40 周线**")).toBe("等回调到 40 周线");
    expect(plainFirstLine("> 引用的一句话\n正文")).toBe("引用的一句话");
    expect(plainFirstLine("1. 第一条 ~~删除~~ <b>加粗</b>")).toBe("第一条 删除 加粗");
    expect(plainFirstLine("![图](a.png) 配图说明")).toBe("图 配图说明");
  });

  it("falls back to the first heading, then to nothing", () => {
    expect(plainFirstLine("# 只有标题\n\n## 二级")).toBe("只有标题");
    expect(plainFirstLine("\n\n")).toBe("");
  });

  it("keeps arithmetic and underscores inside words", () => {
    expect(stripMarkdown("2 * 3 = 6，snake_case 不变")).toBe("2 * 3 = 6，snake_case 不变");
    expect(firstLine("# h\nbody")).toBe("body");
  });
});
