import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import {
  List,
  ActionPanel,
  Action,
  showToast,
  Toast,
  Icon,
  Clipboard,
} from "@raycast/api";
import { TokenService } from "./services/tokenService";
import { SearchResult } from "./types";
import { toChecksumAddress } from "./utils/address";

// Simple hash function that mimics the behavior needed for checksumming
function simpleHash(input: string): string {
  // For simple and stable checksumming:
  // We need a consistent hash that is at least 40 characters long
  // Each character of the hash should be based on the input string

  // This won't be cryptographically secure, but will work for checksumming
  let hash = "";
  let total = 0;

  // Generate hash characters based on character code patterns
  for (let i = 0; i < 40; i++) {
    const position = i % input.length;
    const charCode = input.charCodeAt(position);

    // Combine character code with position to get a more distributed value
    const value = (charCode * 11 + position * 7 + total) % 16;
    total += charCode;

    // Convert to hex character
    hash += value.toString(16);
  }

  return hash;
}

export default function Command() {
  const [searchText, setSearchText] = useState("");
  const [debouncedSearchText, setDebouncedSearchText] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [currentPage, setCurrentPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const tokenService = TokenService.getInstance();

  // Add throttling for selection changes
  const lastSelectionTime = useRef(0);

  // Throttled handler for selection changes
  const handleSelectionChange = useCallback(() => {
    const now = Date.now();
    // Only process selection changes every 300ms maximum
    if (now - lastSelectionTime.current > 300) {
      lastSelectionTime.current = now;

      // Load more results when user approaches the end of the list
      if (results.length > 0 && hasMore) {
        const threshold = Math.max(0, results.length - 5);
        if (results.length > threshold) {
          loadMore();
        }
      }
    }
  }, [results.length, hasMore]);

  useEffect(() => {
    async function initialize() {
      try {
        await tokenService.initialize();
        setIsLoading(false);
      } catch (error) {
        await showToast({
          style: Toast.Style.Failure,
          title: "Failed to initialize token lists",
        });
      }
    }
    initialize();
  }, []);

  // Debounce search text input
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearchText(searchText);
    }, 300); // 300ms delay

    return () => clearTimeout(timer);
  }, [searchText]);

  // Trigger search only when debounced text changes
  useEffect(() => {
    setCurrentPage(0); // Reset to first page on new search
    search(0);
  }, [debouncedSearchText]);

  const search = async (page: number) => {
    if (!debouncedSearchText.trim()) {
      setResults([]);
      setHasMore(false);
      return;
    }

    try {
      setIsLoading(true);
      const { results: searchResults, hasMore: moreResults } =
        await tokenService.searchTokens(debouncedSearchText, page);

      // Single state update with all processing
      setResults((prev) => {
        // For new searches (page 0), just use new results
        if (page === 0) return searchResults;

        // For pagination, combine results while ensuring uniqueness
        const uniqueMap = new Map(
          prev.map((item) => [
            `${item.token.chainId}-${item.token.address}`,
            item,
          ])
        );

        // Add new items
        searchResults.forEach((item) => {
          const key = `${item.token.chainId}-${item.token.address}`;
          if (!uniqueMap.has(key)) uniqueMap.set(key, item);
        });

        return Array.from(uniqueMap.values());
      });

      setHasMore(moreResults);
    } finally {
      setIsLoading(false);
    }
  };

  const loadMore = async () => {
    if (hasMore) {
      const nextPage = currentPage + 1;
      setCurrentPage(nextPage);
      await search(nextPage);
    }
  };

  const toggleFavorite = async (tokenAddress: string) => {
    try {
      await tokenService.toggleFavorite(tokenAddress);
      setResults(
        results.map((result) =>
          result.token.address === tokenAddress
            ? { ...result, isFavorite: !result.isFavorite }
            : result
        )
      );
    } catch (error) {
      await showToast({
        style: Toast.Style.Failure,
        title: "Failed to update favorite status",
      });
    }
  };

  const copyToClipboard = async (token: { address: string }) => {
    // Use the checksumming function on the address
    const checksummedAddress = toChecksumAddress(token.address);

    // Copy the checksummed address to clipboard
    await Clipboard.copy(checksummedAddress);

    // Update last selected timestamp
    await tokenService.updateLastSelected(token.address);

    // Show success toast
    await showToast({
      style: Toast.Style.Success,
      title: "Copied to clipboard",
      message: checksummedAddress,
    });
  };

  // Memoize list items to prevent unnecessary re-renders
  const memoizedResults = useMemo(() => {
    return results.map((result) => (
      <List.Item
        key={`${result.token.chainId}-${result.token.address.toLowerCase()}`}
        icon={
          result.token.logoURI ? { source: result.token.logoURI } : Icon.Circle
        }
        title={result.token.symbol}
        subtitle={result.token.name}
        accessories={[
          { text: `Chain: ${result.token.chainId}` },
          { icon: result.isFavorite ? Icon.Star : Icon.StarDisabled },
        ]}
        actions={
          <ActionPanel>
            <Action
              title="Copy Address"
              onAction={() => copyToClipboard(result.token)}
            />
            <Action
              title={
                result.isFavorite ? "Remove from Favorites" : "Add to Favorites"
              }
              onAction={() => toggleFavorite(result.token.address)}
            />
          </ActionPanel>
        }
      />
    ));
  }, [results]); // Only re-calculate when results change

  // Clear results when component unmounts
  useEffect(() => {
    return () => {
      setResults([]);
    };
  }, []);

  return (
    <List
      isLoading={isLoading}
      searchText={searchText}
      onSearchTextChange={setSearchText}
      searchBarPlaceholder="Search tokens by symbol, name, or address..."
      onSelectionChange={handleSelectionChange}
    >
      {memoizedResults}
      {hasMore && !isLoading && (
        <List.Item
          title="Load more results..."
          icon={Icon.Download}
          actions={
            <ActionPanel>
              <Action title="Load More" onAction={loadMore} />
            </ActionPanel>
          }
        />
      )}
    </List>
  );
}
