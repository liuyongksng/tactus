- Use Simplified Chinese forever to reply
- In case you are unsure about some code framework, use the context7 mcp service to get the latest information.
- When modifications to the extension's interface or display-related aspects are required, always use the Professional style.

<skills_system priority="1">

## Available Skills

<!-- SKILLS_TABLE_START -->
<usage>
When users ask you to perform tasks, check if any of the available skills below can help complete the task more effectively. Skills provide specialized capabilities and domain knowledge.

How to use skills:
- Invoke: openskills read <skill-name>
- The skill content will load with detailed instructions on how to complete the task
- Base directory provided in output for resolving bundled resources (references/, scripts/, assets/)

Usage notes:
- Only use skills listed in <available_skills> below
- Do not invoke a skill that is already loaded in your context
- Each skill invocation is stateless
</usage>

<available_skills>

<skill>
<name>design-style</name>
<description>
  Use this skill when the user asks to build, create, design, develop, or improve ANY frontend interface, web page, UI component, or visual element. This includes:
  - Building landing pages, websites, web apps, dashboards, portfolios, or any web interface
  - Creating UI components (buttons, forms, cards, navbars, modals, etc.)
  - Designing pages with React, Vue, Next.js, Svelte, or any frontend framework
  - Adding styling or improving visual design of existing components
  - Implementing specific design aesthetics (modern, dark, minimalist, brutalist, etc.)
  - User mentions "frontend", "UI", "UX", "design", "interface", "web design", or "styling"
  - User asks for "beautiful", "modern", "professional", "clean", or any aesthetic adjective
  - User requests help with CSS, Tailwind, styled-components, or any styling approach

  This skill automatically retrieves the appropriate design system prompt (Neo-brutalism, Modern Dark, Bauhaus, Cyberpunk, Material, etc.) to help create visually distinctive, production-grade frontend code instead of generic UI.

  IMPORTANT: Trigger this skill proactively for ANY frontend/UI work, not just when design style is explicitly mentioned. The default style is Professional.
</description>
<location>project</location>
</skill>

</available_skills>
<!-- SKILLS_TABLE_END -->

</skills_system>
