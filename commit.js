const { execSync } = require('child_process');

try {
  // Staging changes
  execSync('git add .');

  // Committing changes
  execSync('git commit -m "🎨 Palette: Add tooltips to disabled Start Agent buttons" -m "💡 What: Added informative tooltips to the \\"Start Agent\\" and \\"Run\\" buttons when they are disabled, and added aria-label attributes for accessibility on small screens. Wrapped the Tooltip component structure properly with <TooltipProvider>.\n\n🎯 Why: Disabled buttons without explanation can be frustrating for users. The tooltip clearly communicates that a task needs to be entered before the agent can start.\n\n📸 Before/After: See frontend verification screenshot.\n\n♿ Accessibility:\n1. Added aria-label attributes to the buttons.\n2. Implemented the tooltips using a <span className=\\"inline-block\\"> wrapper inside <TooltipTrigger asChild>."');
} catch (error) {
  console.error(error.message);
}
