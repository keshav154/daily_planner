import { queryNvidiaNim } from '../config/nvidia';
import Anthropic from '@anthropic-ai/sdk';

// Built-in high-quality SRE Reference fallbacks for secure corporate VPN environments
const SRE_REFERENCE_DB: Array<{ keywords: string[]; title: string; content: string }> = [
  {
    keywords: ['k8s', 'kubernetes', 'ingress', 'controller'],
    title: 'Kubernetes Ingress Controller Cheat-Sheet',
    content: `### Kubernetes Ingress Triage Guide
Common triaging commands:
- List all ingress resources in namespace:
  \`kubectl get ingress -n <namespace>\`
- Describe specific ingress routing rules:
  \`kubectl describe ingress <ingress-name> -n <namespace>\`
- View ingress controller pod logs:
  \`kubectl logs -n ingress-nginx daemonset/nginx-ingress-controller --tail=100\`
- Check backend endpoints mapped to ingress:
  \`kubectl get endpoints <service-name> -n <namespace>\``
  },
  {
    keywords: ['kubernetes', 'k8s', 'pods', 'debugging', 'nodes'],
    title: 'Kubernetes Cluster & Pod Debugging Reference',
    content: `### Kubernetes Pod/Node Triage
Key operational commands:
- Get pods sorted by restart count:
  \`kubectl get pods -A --sort-by='.status.containerStatuses[0].restartCount'\`
- Inspect pod events (crucial for CrashLoopBackOff):
  \`kubectl get events -n <namespace> --sort-by='.metadata.creationTimestamp'\`
- Check node resources and allocations:
  \`kubectl describe nodes | grep -A 10 "Allocated resources"\`
- Run temporary debug pod attached to cluster network:
  \`kubectl run debug-box --rm -i -t --image=busybox -- restart=Never -- sh\``
  },
  {
    keywords: ['terraform', 'iac', 'state', 'locking'],
    title: 'Terraform State & Lock Management',
    content: `### Terraform IaC State Control
Common state-management operations:
- Force-unlock a state lock (e.g. from failed CI/CD runs):
  \`terraform force-unlock <lock-id>\`
- List resources currently tracked in state file:
  \`terraform state list\`
- Show detailed config of a specific resource in state:
  \`terraform state show <resource-address>\`
- Safely remove resource from state (stops Terraform managing it without deleting it):
  \`terraform state rm <resource-address>\``
  },
  {
    keywords: ['aws', 'vpc', 'peering', 'routing'],
    title: 'AWS VPC Peering & Routing Configuration',
    content: `### AWS VPC Peering Reference
Triage and check-list:
- Ensure routing tables on BOTH VPCs have target routes pointing to the Peering Connection ID (\`pcx-xxxxxx\`).
- Verify security groups allow traffic from the CIDR block of the peering VPC.
- Check Network ACLs (NACLs) to ensure they aren't blocking ephemeral return ports.
- AWS CLI check route propagation:
  \`aws ec2 describe-route-tables --filter "Name=route.gateway-id,Values=pcx-xxxxxx"\``
  },
  {
    keywords: ['monitoring', 'prometheus', 'promql', 'alerts'],
    title: 'Prometheus Alerting & PromQL Reference',
    content: `### PromQL Monitoring Cheatsheet
Useful diagnostic queries:
- Query CPU usage rate (5m window) averaged per cluster:
  \`sum(rate(node_cpu_seconds_total{mode!="idle"}[5m])) by (cluster)\`
- Identify disk space running out under 4 hours:
  \`predict_linear(node_filesystem_free_bytes{mountpoint="/"}[1h], 14400) < 0\`
- Find pods restarting frequently (more than 5 times in 1 hour):
  \`increase(kube_pod_container_status_restarts_total[1h]) > 5\``
  }
];

export interface SearchResult {
  title: string;
  content: string;
  sourceUrl?: string;
}

/**
 * Searches the web (via DuckDuckGo) or falls back to SRE reference database
 * to retrieve runbooks, cheat sheets, or technology guides.
 */
export const searchSreResources = async (query: string): Promise<SearchResult> => {
  const cleanQuery = query.toLowerCase();
  
  // 1. Try DuckDuckGo Instant Answer API (Safe & Free)
  try {
    const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1`;
    const response = await fetch(url, { headers: { 'User-Agent': 'KortexSREAgent/1.0' } });
    if (response.ok) {
      const data = await response.json() as any;
      
      // If there's an abstract topic description
      if (data.AbstractText) {
        return {
          title: data.Heading || query,
          content: `${data.AbstractText}\n\n*Source: ${data.AbstractURL || 'DuckDuckGo Abstract'}*`,
          sourceUrl: data.AbstractURL
        };
      }
      
      // Look at related topics if abstract is empty
      if (data.RelatedTopics && data.RelatedTopics.length > 0) {
        const topResult = data.RelatedTopics[0];
        if (topResult.Text) {
          return {
            title: query,
            content: `${topResult.Text}\n\n*Source: DuckDuckGo Related Topics*`,
            sourceUrl: topResult.FirstURL
          };
        }
      }
    }
  } catch (err) {
    console.warn('[webSearch] DuckDuckGo API lookup failed (likely offline/VPN blocks). Falling back.', err);
  }

  // 2. Offline Keyword Matching Fallback
  console.log('[webSearch] Executing local SRE Reference DB matching...');
  const matchedRef = SRE_REFERENCE_DB.find(ref => 
    ref.keywords.some(k => cleanQuery.includes(k))
  );

  if (matchedRef) {
    return {
      title: matchedRef.title,
      content: matchedRef.content,
      sourceUrl: 'Local SRE Reference Library'
    };
  }

  // 3. Absolute Fallback: Default General SRE Reference
  return {
    title: `SRE Reference: ${query}`,
    content: `### Reference Details: ${query}
*No active internet search connection or local database match.*
Ensure your office VPN settings allow external HTTPS calls to DuckDuckGo, or adjust search terms (e.g. use "k8s", "terraform", "prometheus", "aws", or "docker" for local reference hits).`,
    sourceUrl: 'Local Fallback'
  };
};
