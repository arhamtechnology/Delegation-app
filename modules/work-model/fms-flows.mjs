// FMS flows, one per ERP cycle. Each shows as an item under FMS in the sidebar at /fms/<slug>.
// Add a flow: a row in fms_processes with its steps, an ERP feed, then an entry here and in the sidebar.
export const fmsFlows = {
  order: {
    process: 'sales_order',
    title: 'Order FMS',
    description: 'The order cycle from the ERP: punching and approval, dispatch, invoice and transport, against each step\'s ETA.',
  },
};

export function fmsFlowTitle(process) {
  return Object.values(fmsFlows).find((flow) => flow.process === process)?.title || 'FMS';
}
