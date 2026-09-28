import type { Component } from 'svelte';
import type { ToolViewProps } from '../../lib/tool-helpers';
import Agent from './Agent.svelte';
import Bash from './Bash.svelte';
import Edit from './Edit.svelte';
import Generic from './Generic.svelte';
import Read from './Read.svelte';
import Search from './Search.svelte';
import Write from './Write.svelte';

/** Renderer je Tool-Name. Unbekannte Tools nutzen den generischen JSON-Renderer. */
const renderers: Record<string, Component<ToolViewProps>> = {
  Bash,
  Read,
  Edit,
  MultiEdit: Edit,
  Write,
  Agent,
  Task: Agent,
  Grep: Search,
  Glob: Search,
};

export function rendererFor(name: string): Component<ToolViewProps> {
  return renderers[name] ?? Generic;
}
