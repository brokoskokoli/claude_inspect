<script lang="ts">
  import type { Hunk } from '../lib/tool-helpers';

  let { hunks, oldStr, newStr }: { hunks?: Hunk[]; oldStr?: string; newStr?: string } = $props();

  type Row = { kind: ' ' | '-' | '+' | '@'; text: string; o?: number; n?: number };

  const rows = $derived.by((): Row[] => {
    const out: Row[] = [];
    if (hunks?.length) {
      for (const h of hunks) {
        out.push({ kind: '@', text: `@@ -${h.oldStart},${h.oldLines} +${h.newStart},${h.newLines} @@` });
        let o = h.oldStart;
        let n = h.newStart;
        for (const l of h.lines) {
          const k = (l[0] ?? ' ') as Row['kind'];
          const text = l.slice(1);
          if (k === '-') out.push({ kind: '-', text, o: o++ });
          else if (k === '+') out.push({ kind: '+', text, n: n++ });
          else out.push({ kind: ' ', text, o: o++, n: n++ });
        }
      }
    } else {
      for (const l of (oldStr ?? '').split('\n')) if (oldStr) out.push({ kind: '-', text: l });
      for (const l of (newStr ?? '').split('\n')) if (newStr) out.push({ kind: '+', text: l });
    }
    return out;
  });
</script>

<div class="diff">
  <table>
    <tbody>
      {#each rows as r, i (i)}
        <tr class="k{r.kind === '+' ? 'add' : r.kind === '-' ? 'del' : r.kind === '@' ? 'hunk' : 'ctx'}">
          <td class="ln">{r.o ?? ''}</td>
          <td class="ln">{r.n ?? ''}</td>
          <td class="sign">{r.kind === '@' ? '' : r.kind}</td>
          <td class="code"><pre>{r.text}</pre></td>
        </tr>
      {/each}
    </tbody>
  </table>
</div>

<style>
  .diff {
    max-height: 480px;
    overflow: auto;
    border-radius: 6px;
    background: var(--code-bg);
  }
  table {
    border-collapse: collapse;
    width: 100%;
    font-family: var(--mono);
    font-size: 12px;
  }
  td {
    padding: 0 6px;
    vertical-align: top;
  }
  .ln {
    width: 1%;
    color: var(--faint);
    text-align: right;
    user-select: none;
    font-variant-numeric: tabular-nums;
  }
  .sign {
    width: 1%;
    user-select: none;
    color: var(--faint);
  }
  .kadd {
    background: var(--add);
  }
  .kadd .code,
  .kadd .sign {
    color: var(--add-text);
  }
  .kdel {
    background: var(--del);
  }
  .kdel .code,
  .kdel .sign {
    color: var(--del-text);
  }
  .khunk td {
    color: var(--info);
    background: var(--info-soft);
    padding-top: 2px;
    padding-bottom: 2px;
  }
</style>
