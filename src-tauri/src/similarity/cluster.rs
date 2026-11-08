//! SmartSim's clustering: scikit-learn `AgglomerativeClustering(metric="precomputed",
//! linkage="average")` on cosine distances (`1 - similarity`), cut either into a number of
//! clusters or at a distance threshold.
//!
//! The tree is built with the nearest-neighbor-chain algorithm, which produces the same
//! average-linkage merges as SciPy's `linkage` (what scikit-learn calls). Merges are sorted by
//! distance and numbered like SciPy's linkage matrix, then cut with scikit-learn's `_hc_cut`
//! (including Python's `heapq` order), so cluster labels match scikit-learn's exactly.

use rayon::prelude::*;

/// How to cut the tree, mirroring SmartSim's `perform_clustering`.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Cut {
    /// Exactly this many clusters (or fewer when there are fewer images).
    Clusters(usize),
    /// Merge only while the average cosine distance is below `1 - similarity`.
    Similarity(f32),
}

impl Cut {
    /// SmartSim uses the cluster count when only it is given, the threshold when only it is
    /// given, and 10 clusters otherwise.
    pub fn from_options(max_clusters: Option<usize>, similarity_threshold: Option<f32>) -> Self {
        match (max_clusters, similarity_threshold) {
            (Some(clusters), None) => Cut::Clusters(clusters),
            (None, Some(similarity)) => Cut::Similarity(similarity),
            _ => Cut::Clusters(10),
        }
    }
}

struct Merge {
    a: usize,
    b: usize,
    distance: f64,
}

/// Cluster label per vector. Vectors must be L2-normalized, so the dot product is the cosine
/// similarity.
pub fn cluster(vectors: &[Vec<f32>], cut: Cut) -> Vec<usize> {
    let n = vectors.len();
    if n < 2 {
        return vec![0; n];
    }

    // Condensed full matrix of cosine distances.
    let mut distance: Vec<f64> = vec![0.0; n * n];
    distance.par_chunks_mut(n).enumerate().for_each(|(i, row)| {
        for (j, cell) in row.iter_mut().enumerate() {
            if i != j {
                let similarity: f64 = vectors[i].iter().zip(&vectors[j]).map(|(a, b)| (*a as f64) * (*b as f64)).sum();
                *cell = 1.0 - similarity;
            }
        }
    });

    let mut merges = nearest_neighbor_chain(&mut distance, n);
    merges.sort_by(|x, y| x.distance.total_cmp(&y.distance));
    let children = linkage_children(&merges, n);

    // scikit-learn raises for more clusters than images; SmartSim would fail, Ambit clamps.
    let clusters = match cut {
        Cut::Clusters(clusters) => clusters.clamp(1, n),
        Cut::Similarity(similarity) => {
            let limit = 1.0 - similarity as f64;
            merges.iter().filter(|merge| merge.distance >= limit).count() + 1
        }
    };
    hc_cut(clusters, &children, n)
}

/// SciPy's linkage numbering: leaves are `0..n`, merge `i` creates node `n + i`, and each row
/// lists its two children smaller id first.
fn linkage_children(merges: &[Merge], n: usize) -> Vec<(usize, usize)> {
    let mut parent: Vec<usize> = (0..n).collect();
    let mut node_of_root: Vec<usize> = (0..n).collect();
    merges
        .iter()
        .enumerate()
        .map(|(i, merge)| {
            let (a, b) = (find(&mut parent, merge.a), find(&mut parent, merge.b));
            let (x, y) = (node_of_root[a], node_of_root[b]);
            parent[a] = b;
            node_of_root[b] = n + i;
            (x.min(y), x.max(y))
        })
        .collect()
}

/// scikit-learn's `_hc_cut`: split the root with a max-heap of node ids (Python's `heapq` on
/// negated ids) until there are `clusters` nodes, then label each node's leaves by its position
/// in the heap list.
fn hc_cut(clusters: usize, children: &[(usize, usize)], n: usize) -> Vec<usize> {
    let root = children.last().map(|&(_, y)| y + 1).unwrap_or(0);
    let mut heap: Vec<i64> = vec![-(root as i64)];
    for _ in 1..clusters {
        let (a, b) = children[(-heap[0]) as usize - n];
        heap_push(&mut heap, -(a as i64));
        heap_push_pop(&mut heap, -(b as i64));
    }
    let mut labels = vec![0; n];
    for (label, node) in heap.iter().enumerate() {
        let mut stack = vec![(-node) as usize];
        while let Some(id) = stack.pop() {
            if id < n {
                labels[id] = label;
            } else {
                let (a, b) = children[id - n];
                stack.extend([a, b]);
            }
        }
    }
    labels
}

/// Python's `heapq.heappush`.
fn heap_push(heap: &mut Vec<i64>, item: i64) {
    heap.push(item);
    let last = heap.len() - 1;
    sift_down(heap, 0, last);
}

/// Python's `heapq.heappushpop` (the popped value is not needed).
fn heap_push_pop(heap: &mut [i64], item: i64) {
    if !heap.is_empty() && heap[0] < item {
        heap[0] = item;
        sift_up(heap, 0);
    }
}

/// Python's `heapq._siftdown`.
fn sift_down(heap: &mut [i64], start: usize, mut pos: usize) {
    let item = heap[pos];
    while pos > start {
        let parent = (pos - 1) >> 1;
        if item < heap[parent] {
            heap[pos] = heap[parent];
            pos = parent;
            continue;
        }
        break;
    }
    heap[pos] = item;
}

/// Python's `heapq._siftup`.
fn sift_up(heap: &mut [i64], mut pos: usize) {
    let (end, start, item) = (heap.len(), pos, heap[pos]);
    let mut child = 2 * pos + 1;
    while child < end {
        let right = child + 1;
        if right < end && heap[child] >= heap[right] {
            child = right;
        }
        heap[pos] = heap[child];
        pos = child;
        child = 2 * pos + 1;
    }
    heap[pos] = item;
    sift_down(heap, start, pos);
}

fn find(parent: &mut [usize], mut i: usize) -> usize {
    while parent[i] != i {
        parent[i] = parent[parent[i]];
        i = parent[i];
    }
    i
}

/// Average-linkage merges via the nearest-neighbor chain. Each merged cluster keeps the slot of
/// one of its members, so a merge's `a`/`b` are original points inside the two clusters.
fn nearest_neighbor_chain(distance: &mut [f64], n: usize) -> Vec<Merge> {
    let mut active = vec![true; n];
    let mut size = vec![1usize; n];
    let mut chain: Vec<usize> = Vec::with_capacity(n);
    let mut merges = Vec::with_capacity(n - 1);

    while merges.len() < n - 1 {
        if chain.is_empty() {
            chain.push(active.iter().position(|&a| a).unwrap_or(0));
        }
        let (a, b, d) = loop {
            let a = *chain.last().unwrap_or(&0);
            let previous = if chain.len() >= 2 { Some(chain[chain.len() - 2]) } else { None };
            // Nearest active neighbor; ties prefer the previous chain element so the chain ends.
            let mut best = previous.unwrap_or(usize::MAX);
            let mut best_distance = previous.map(|p| distance[a * n + p]).unwrap_or(f64::INFINITY);
            for candidate in 0..n {
                if candidate == a || !active[candidate] {
                    continue;
                }
                let candidate_distance = distance[a * n + candidate];
                if candidate_distance < best_distance {
                    best = candidate;
                    best_distance = candidate_distance;
                }
            }
            if Some(best) == previous {
                chain.pop();
                chain.pop();
                break (a, best, best_distance);
            }
            chain.push(best);
        };

        // Merge a into b (Lance-Williams update for average linkage).
        let (size_a, size_b) = (size[a] as f64, size[b] as f64);
        for k in 0..n {
            if !active[k] || k == a || k == b {
                continue;
            }
            let updated = (size_a * distance[a * n + k] + size_b * distance[b * n + k]) / (size_a + size_b);
            distance[b * n + k] = updated;
            distance[k * n + b] = updated;
        }
        active[a] = false;
        size[b] += size[a];
        merges.push(Merge { a, b, distance: d });
    }
    merges
}

#[cfg(test)]
mod tests {
    use super::{cluster, Cut};

    fn point(angle_degrees: f32) -> Vec<f32> {
        let radians = angle_degrees.to_radians();
        let mut v = vec![0.0; 4];
        v[0] = radians.cos();
        v[1] = radians.sin();
        v
    }

    fn groups() -> Vec<Vec<f32>> {
        // Three tight groups on the unit circle.
        [0.0, 2.0, 4.0, 90.0, 92.0, 180.0, 181.0, 183.0].iter().map(|a| point(*a)).collect()
    }

    // Expected labels are scikit-learn's own output for these points
    // (AgglomerativeClustering(metric="precomputed", linkage="average")), so the cluster
    // numbering, and therefore the order SmartSim shows clusters in, matches too.
    const ONE_PER_IMAGE: [usize; 8] = [7, 6, 5, 2, 4, 3, 1, 0];

    #[test]
    fn cuts_into_the_requested_number_of_clusters() {
        assert_eq!(cluster(&groups(), Cut::Clusters(3)), vec![0, 0, 0, 2, 2, 1, 1, 1]);
        assert_eq!(cluster(&groups(), Cut::Clusters(1)), vec![0; 8]);
        assert_eq!(cluster(&groups(), Cut::Clusters(8)), ONE_PER_IMAGE);
        // More clusters than images is clamped (scikit-learn raises).
        assert_eq!(cluster(&groups(), Cut::Clusters(20)), ONE_PER_IMAGE);
    }

    #[test]
    fn cuts_at_a_similarity_threshold() {
        // Within a group the similarity is above 0.99; across groups it is 0 or -1.
        assert_eq!(cluster(&groups(), Cut::Similarity(0.99)), vec![0, 0, 0, 2, 2, 1, 1, 1]);
        assert_eq!(cluster(&groups(), Cut::Similarity(1.0)), ONE_PER_IMAGE);
    }

    #[test]
    fn follows_smartsim_defaults() {
        assert_eq!(Cut::from_options(Some(4), None), Cut::Clusters(4));
        assert_eq!(Cut::from_options(None, Some(0.7)), Cut::Similarity(0.7));
        assert_eq!(Cut::from_options(Some(4), Some(0.7)), Cut::Clusters(10));
        assert_eq!(Cut::from_options(None, None), Cut::Clusters(10));
    }
}
