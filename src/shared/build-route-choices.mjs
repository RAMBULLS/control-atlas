/** @param {{templates: {name: string, supported_formats: string[]}[]}} templates
 * @param {{workflows: {workflow_id: string}[]}} workflows */
export function buildRouteChoices(templates, workflows) {
  return {
    templates: templates.templates.map(template => ({ name: template.name, supported_formats: template.supported_formats })),
    workflowIds: workflows.workflows.map(workflow => workflow.workflow_id),
  };
}
