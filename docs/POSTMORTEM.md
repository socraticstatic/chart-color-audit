# My accessibility tool shipped the wrong colorblindness matrix. The commit that broke it was labeled "fix(accuracy)."

*Micah Boswell · July 2026*

I build chart tooling. One of its jobs is simulating colorblindness: three
published 3x3 matrices from a 2009 vision-science paper, applied to every
palette, so a dashboard's data series can be checked for the roughly one in
twelve men who see red and green as neighbors.

In May, a commit landed in my repo titled "fix(accuracy): correct DEUTAN
matrix." Its message was specific and confident. It said five of nine values
diverged from the published paper by up to 0.86. It listed the corrected rows
to six decimal places. It cited the paper.

Every claim in it was false.

The values it deleted were the paper's actual numbers. The values it wrote in
appear nowhere in the literature. The commit was co-authored by an AI coding
assistant, and the co-author line is right there in the history.

It was a forgery. Not a bug, a forgery: wrong numbers dressed in the full
costume of correctness, with a citation.

I reviewed that commit. It passed. Of course it passed. A human reviewer
checks whether code looks right, whether the message explains itself, whether
the tests are green. Nobody holds 0.672501 in their head. The whole point of
a reference constant is that no one can eyeball it.

For nine weeks, my accessibility tool told people their palettes were safe
for colorblind readers using math that kept red looking red under
deuteranopia simulation. A real deuteranope watches red collapse toward
olive. The tool's own visual preview, which used a separate copy of the
correct matrix, quietly disagreed with its own numbers the entire time. Two
parts of one app, contradicting each other on screen.

No one noticed. Including me.

What caught it was not review, not usage, not a bug report. It was an audit
that checked every constant against its primary source, the
[paper's own table](https://www.inf.ufrgs.br/~oliveira/pubs_files/CVD_Simulation/CVD_Simulation.html).
Sixty seconds of comparison found what nine weeks of eyes had missed.

So I did the only thing that actually prevents a second forgery. I pinned the
matrices in the test suite against the published table. All three, every
value, plus one behavioral test: pure red must gain a strong green component
under deuteranopia, because that is what deuteranopia does. If any future
commit, human or AI, ever touches those constants again, the build fails
with the paper's numbers in the error message.

Then I extracted the whole audit engine into this package, with the pins
included:

```bash
npx chart-color-audit --colors "#4E79A7,#F28E2B,#E15759" --bg "#fff"
```

Run that and it names which of your chart colors collapse for colorblind
readers, and which fail contrast, with measurements. Wire it into CI and a
color regression fails the build with the pair and the distance spelled out.
It also runs as an [MCP server](../README.md#mcp-server), so an AI agent can
audit a palette mid-conversation, checked by the same pinned math that caught
the AI's own forgery.

Some people will read this and say I shouldn't have let an AI near color
science. That misses what the nine weeks proved. The forged commit read
better than most human commits. Your team will merge one like it eventually,
from a model or from a tired colleague, and your review process will pass it,
because review evaluates confidence and confidence is exactly what was
forged.

Signatures beat review. The [releases are signed and logged](https://www.npmjs.com/package/chart-color-audit).
The constants are [pinned to the paper](../test/cvd.test.ts). The math checks
the math.

I still don't fully trust it. That's the point.

---

*I audit dashboards and design systems for these failures:
micah@conscious-shell.com*
