// Flag to track if authentication was initiated by the extension
let extensionInitiatedAuth = false;

// Cache ID prefix - use this to identify extension-generated cache IDs
const CACHE_ID_PREFIX = "twitter_auth_";

// Listen for messages from popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
	// Handle any messages from popup.js if needed
	if (message.action === "checkAuth") {
		chrome.storage.local.get(["twitter_authenticated", "twitter_access_token", "twitter_refresh_token"], (result) => {
			sendResponse({ 
				authenticated: !!result.twitter_authenticated,
				hasAccessToken: !!result.twitter_access_token,
				hasRefreshToken: !!result.twitter_refresh_token
			});
		});
		return true; // Required for async response
	}
	
	// Add Twitter auth initiation handler
	if (message.action === "initTwitterAuth") {
		// Set the flag to indicate this auth flow was initiated by the extension
		extensionInitiatedAuth = true;
		
		// Generate and store a random cache_id for this auth session
		const cacheId = `${CACHE_ID_PREFIX}${Math.random().toString(36).substring(2, 15)}`;
		chrome.storage.local.set({ "twitter_cache_id": cacheId }, () => {
			console.log("Cache ID stored for Twitter auth:", cacheId);
			sendResponse({ status: "cache_id_stored", cache_id: cacheId });
		});
		return true; // Required for async response
	}
	
	// Add handler to get stored tokens
	if (message.action === "getTwitterTokens") {
		chrome.storage.local.get(["twitter_access_token", "twitter_refresh_token", "twitter_user_data"], (result) => {
			sendResponse({
				access_token: result.twitter_access_token || null,
				refresh_token: result.twitter_refresh_token || null,
				user_data: result.twitter_user_data || null
			});
		});
		return true; // Required for async response
	}
});

// Listen for tab updates to handle the OAuth callback
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
	// Only proceed if URL has changed and is our callback URL
	if (
		changeInfo.url?.startsWith("http://127.0.0.1:3000/auth/twitter-callback") 
	) {
		console.log("OAuth callback detected:", changeInfo.url, "Extension initiated:", extensionInitiatedAuth);
		
		// Parse the URL
		const url = new URL(changeInfo.url);
		const state = url.searchParams.get("state");
		const code = url.searchParams.get("code");

		// If we already have cache_id in the URL, no need to modify it
		if (url.searchParams.get("cache_id")) {
			console.log("URL already has cache_id, no need to modify");
			return;
		}
		
		// CRITICAL: If this is NOT an extension-initiated auth flow,
		// don't modify the URL to prevent breaking frontend React login
		if (!extensionInitiatedAuth) {
			console.log("Not an extension-initiated auth flow. Letting React frontend handle it.");
			return;
		}

		// Get the stored cache_id
		chrome.storage.local.get(["twitter_cache_id"], (result) => {
			const cacheId = result.twitter_cache_id;

			if (!cacheId) {
				console.error("No cache_id found in storage");
				
				// Instead of failing, generate a new cache_id for this session
				const newCacheId = `${CACHE_ID_PREFIX}${Math.random().toString(36).substring(2, 15)}`;
				console.log("Generated new emergency cache_id:", newCacheId);
				
				// Store the new cache_id
				chrome.storage.local.set({ "twitter_cache_id": newCacheId }, () => {
					// Construct the complete callback URL with the new cache_id
					const completeCallbackUrl = `${changeInfo.url}&cache_id=${newCacheId}`;
					console.log("Redirecting to complete callback URL with new cache_id:", completeCallbackUrl);
					
					// Update the tab with the complete URL
					chrome.tabs.update(tabId, { url: completeCallbackUrl });
				});
				return;
			}

			// Construct the complete callback URL with cache_id
			const completeCallbackUrl = `${changeInfo.url}&cache_id=${cacheId}`;
			console.log("Redirecting to complete callback URL:", completeCallbackUrl);

			// Update the tab with the complete URL
			chrome.tabs.update(tabId, { url: completeCallbackUrl });
		});
	}
});

// Listen for completed loads to handle authentication response
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
	// Only process when page is completely loaded and we're on the correct page
	if (changeInfo.status === 'complete' && 
		tab.url && 
		tab.url.startsWith("http://127.0.0.1:3000/auth/twitter-callback")) {
		
		// Verify if this is an extension-initiated flow by checking for our cache_id format
		// But DO NOT override extensionInitiatedAuth flag if it's a frontend flow
		const url = new URL(tab.url);
		const cacheId = url.searchParams.get("cache_id");
		if (cacheId?.startsWith("twitter_auth_") && extensionInitiatedAuth) {
			console.log("Confirmed as extension-initiated auth flow with valid cache_id");
			// extensionInitiatedAuth flag stays true
		} else if (!extensionInitiatedAuth) {
			// This is likely a frontend auth flow
			console.log("Identified as frontend auth flow, not extension-initiated");
		}
		
		// IMPORTANT: Only monitor for success if this was an extension-initiated flow
		if (!extensionInitiatedAuth) {
			console.log("Skipping active token extraction - not an extension-initiated flow");
			
			// But we can still try to passively capture tokens for future use
			// This runs only once after the page is loaded
			passivelyCheckForTokens(tabId);
			return;
		}
		
		console.log("Twitter callback page fully loaded, monitoring for success");
		
		// Set up a monitor to check for successful authentication
		const checkAuthSuccess = () => {
			chrome.scripting.executeScript({
				target: { tabId: tabId },
				function: checkTwitterAuthStatus
			})
			.then(results => {
				if (results[0]?.result) {
					const result = results[0].result;
					console.log("Auth status check result:", result);
					
					if (result.authenticated) {
						// Authentication was successful, extract tokens from localStorage/cookies
						chrome.scripting.executeScript({
							target: { tabId: tabId },
							function: extractTokensFromPage
						})
						.then(tokenResults => {
							if (tokenResults[0]?.result) {
								const tokenData = tokenResults[0].result;
								console.log("Token extraction result:", tokenData);
								
								// Store tokens in extension's storage
								const dataToStore = {
									twitter_authenticated: true
								};
								
								if (tokenData.userData) {
									dataToStore.twitter_user_data = tokenData.userData;
								}
								
								if (tokenData.accessToken) {
									dataToStore.twitter_access_token = tokenData.accessToken;
								}
								
								if (tokenData.refreshToken) {
									dataToStore.twitter_refresh_token = tokenData.refreshToken;
								}
								
								chrome.storage.local.set(dataToStore, () => {
									console.log("Twitter authentication data stored in extension storage:", dataToStore);
									
									// Clear the cache_id from storage after authentication completes successfully
									chrome.storage.local.remove("twitter_cache_id");
									
									// Reset the initiation flag now that we're done
									extensionInitiatedAuth = false;
									
									// Update popup to dashboard
									chrome.action.setPopup({ popup: "dashboard.html" });
									
									// Send success message to any open popup
									try {
										chrome.runtime.sendMessage({
											action: "twitter_auth_complete",
											success: true,
											userData: tokenData.userData || {}
										});
									} catch (e) {
										console.log("Could not send message to popup, it may be closed");
									}
									
									// Optionally open the extension dashboard
									chrome.tabs.create({ url: "dashboard.html" });
								});
							} else {
								console.log("No token data returned, will retry...");
								// If tokens aren't ready yet, try again in a moment
								setTimeout(checkAuthSuccess, 1000);
							}
						})
						.catch(error => {
							console.error("Error executing token extraction script:", error);
							// Try again if there was an error
							setTimeout(checkAuthSuccess, 1000);
						});
					} else if (result.checking) {
						// Still waiting for authentication to complete, check again in a moment
						console.log("Authentication still in progress, checking again soon...");
						setTimeout(checkAuthSuccess, 1000);
					} else if (result.error) {
						// Authentication failed
						console.error("Authentication failed:", result.error);
						// Reset the initiation flag
						extensionInitiatedAuth = false;
						// Notify any open popup
						try {
							chrome.runtime.sendMessage({
								action: "twitter_auth_complete",
								success: false,
								error: result.error
							});
						} catch (e) {
							console.log("Could not send failure message to popup");
						}
					}
				}
			})
			.catch(error => {
				console.error("Error checking auth status:", error);
				// Try again if there was an error
				setTimeout(checkAuthSuccess, 1000);
			});
		};
		
		// Start checking for authentication success
		checkAuthSuccess();
	}
});

// Function to passively check for tokens on the page without interfering
function passivelyCheckForTokens(tabId) {
	// We'll try multiple times with increasing delays to ensure we catch the tokens
	// after the React app has had time to process and store them
	const checkTimes = [2000, 5000, 10000]; // Check after 2, 5, and 10 seconds
	
	checkTimes.forEach((delay) => {
		setTimeout(() => {
			console.log(`Passively checking for tokens (delay: ${delay}ms)...`);
			
			chrome.scripting.executeScript({
				target: { tabId: tabId },
				function: extractTokensFromPage
			})
			.then(results => {
				if (results[0]?.result) {
					const tokenData = results[0].result;
					
					// Only proceed if we actually found usable tokens
					if (tokenData.accessToken || tokenData.refreshToken) {
						console.log("Found tokens in frontend authentication flow, storing for future use");
						
						const dataToStore = {
							twitter_authenticated: true
						};
						
						if (tokenData.userData) {
							dataToStore.twitter_user_data = tokenData.userData;
						}
						
						if (tokenData.accessToken) {
							dataToStore.twitter_access_token = tokenData.accessToken;
						}
						
						if (tokenData.refreshToken) {
							dataToStore.twitter_refresh_token = tokenData.refreshToken;
						}
						
						chrome.storage.local.set(dataToStore, () => {
							console.log("Passively captured Twitter auth data stored for future use");
							
							// Update popup to dashboard if tokens were successfully captured
							chrome.action.setPopup({ popup: "dashboard.html" });
						});
					} else {
						console.log(`No tokens found at ${delay}ms delay, will try again later if scheduled`);
					}
				}
			})
			.catch(error => {
				console.log(`Passive token check at ${delay}ms failed, but that's okay:`, error);
			});
		}, delay);
	});
}

// Function to check if authentication is complete by examining the page
function checkTwitterAuthStatus() {
	console.log("Checking Twitter authentication status");
	
	try {
		// Check if we have success indicators in the page content
		const pageContent = document.body.innerText;
		
		// Check for authentication success message
		if (pageContent.includes("Authentication successful") || 
			pageContent.includes("Redirecting to dashboard")) {
			console.log("Found success message in page");
			return { authenticated: true };
		}
		
		// Check for authentication failure message
		if (pageContent.includes("Authentication failed") || 
			pageContent.includes("Error:")) {
			const errorMatch = pageContent.match(/Error:\s*([^\n]+)/);
			const error = errorMatch ? errorMatch[1] : "Unknown authentication error";
			console.log("Found error message in page:", error);
			return { authenticated: false, error };
		}
		
		// Check localStorage for authentication status
		const authenticated = localStorage.getItem("twitter_authenticated") === "true";
		if (authenticated) {
			console.log("Found twitter_authenticated=true in localStorage");
			return { authenticated: true };
		}
		
		// Still waiting for authentication to complete
		console.log("Authentication status not yet determined");
		return { checking: true };
	} catch (error) {
		console.error("Error checking authentication status:", error);
		return { error: error.message };
	}
}

// Function to extract tokens from the page after successful authentication
function extractTokensFromPage() {
	console.log("Extracting Twitter tokens from page");
	
	try {
		let userData = null;
		let accessToken = null;
		let refreshToken = null;
		
		// Extract user data from localStorage
		const userDataStr = localStorage.getItem("twitter_user_data");
		if (userDataStr) {
			try {
				userData = JSON.parse(userDataStr);
				console.log("Extracted user data from localStorage");
			} catch (e) {
				console.error("Error parsing user data:", e);
			}
		}
		
		// Try multiple possible storage locations for tokens
		
		// 1. Check cookies first
		try {
			const cookies = document.cookie.split(';');
			for (const cookie of cookies) {
				const [name, value] = cookie.trim().split('=');
				if (name === 'twitter_access_token') {
					accessToken = decodeURIComponent(value);
					console.log("Found access_token in cookies");
					break;
				}
			}
		} catch (e) {
			console.error("Error extracting access token from cookies:", e);
		}
		
		// 2. Check localStorage for tokens (React frontend might store here)
		if (!accessToken) {
			const localStorageToken = localStorage.getItem("twitter_access_token");
			if (localStorageToken) {
				accessToken = localStorageToken;
				console.log("Found access_token in localStorage");
			}
		}
		
		// 3. Check sessionStorage for tokens
		if (!accessToken) {
			const sessionStorageToken = sessionStorage.getItem("twitter_access_token");
			if (sessionStorageToken) {
				accessToken = sessionStorageToken;
				console.log("Found access_token in sessionStorage");
			}
		}
		
		// Similar multiple checks for refresh token
		refreshToken = localStorage.getItem("twitter_refresh_token") || 
					   sessionStorage.getItem("twitter_refresh_token");
		
		if (refreshToken) {
			console.log("Found refresh_token in storage");
		}
		
		// Look for tokens in global variables that might be set by the React app
		if (!accessToken && window.twitterAuthData?.accessToken) {
			accessToken = window.twitterAuthData.accessToken;
			console.log("Found access_token in global variable");
		}
		
		if (!refreshToken && window.twitterAuthData?.refreshToken) {
			refreshToken = window.twitterAuthData.refreshToken;
			console.log("Found refresh_token in global variable");
		}
		
		// Return the extracted data
		return {
			userData,
			accessToken,
			refreshToken
		};
	} catch (error) {
		console.error("Error extracting tokens:", error);
		return { error: error.message };
	}
}