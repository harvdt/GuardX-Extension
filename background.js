let extensionInitiatedAuth = false;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
	if (message.action === "checkAuth") {
		chrome.storage.local.get(
			[
				"twitter_authenticated",
				"twitter_access_token",
				"twitter_refresh_token",
				"backend_token",
			],
			(result) => {
				sendResponse({
					authenticated: !!result.twitter_authenticated,
					hasAccessToken: !!result.twitter_access_token,
					hasRefreshToken: !!result.twitter_refresh_token,
					hasBackendToken: !!result.backend_token,
				});
			},
		);
		return true;
	}

	if (message.action === "getTwitterTokens") {
		chrome.storage.local.get(
			[
				"twitter_access_token",
				"twitter_refresh_token",
				"twitter_user_data",
				"backend_token",
			],
			(result) => {
				sendResponse({
					access_token: result.twitter_access_token || null,
					refresh_token: result.twitter_refresh_token || null,
					user_data: result.twitter_user_data || null,
					backend_token: result.backend_token || null,
				});
			},
		);
		return true;
	}

	if (message.action === "auth_data_extracted") {
		if (message.success && message.userData) {
			const userData = message.userData;
			const dataToStore = {
				twitter_authenticated: true,
			};

			if (userData.twitter_username && userData.twitter_user_id) {
				dataToStore.twitter_user_data = {
					twitter_user_id: userData.twitter_user_id,
					twitter_username: userData.twitter_username,
				};
			}

			if (userData.refresh_token) {
				dataToStore.twitter_refresh_token = userData.refresh_token;
			}

			if (userData.backend_token) {
				dataToStore.backend_token = userData.backend_token;
			}

			chrome.storage.local.set(dataToStore, () => {
				extensionInitiatedAuth = false;

				chrome.storage.local.remove("twitter_cache_id");

				chrome.action.setPopup({ popup: "dashboard.html" });

				try {
					chrome.runtime.sendMessage({
						action: "twitter_auth_complete",
						success: true,
						userData: dataToStore.twitter_user_data || {},
					});
				} catch (e) {
				}
			});
		}

		sendResponse({ received: true });
		return true;
	}

	if (message.action === "callback_page_loaded") {
		sendResponse({ received: true });
		return true;
	}
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
	if (
		changeInfo.url?.startsWith("http://127.0.0.1:3000/auth/twitter-callback")
	) {
		const url = new URL(changeInfo.url);
		const state = url.searchParams.get("state");
		const code = url.searchParams.get("code");

		if (url.searchParams.get("cache_id")) {
			return;
		}

		if (!extensionInitiatedAuth) {
			return;
		}

		chrome.storage.local.get(["twitter_cache_id"], (result) => {
			const cacheId = result.twitter_cache_id;

			if (!cacheId) {
				console.error("No cache_id found in storage");

				return;
			}

			const completeCallbackUrl = `${changeInfo.url}&cache_id=${cacheId}`;

			chrome.tabs.update(tabId, { url: completeCallbackUrl });
		});
	}
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
	if (
		changeInfo.status === "complete" &&
		tab.url &&
		tab.url.startsWith("http://127.0.0.1:3000/auth/twitter-callback")
	) {
		const url = new URL(tab.url);
		const cacheId = url.searchParams.get("cache_id");

		if (!extensionInitiatedAuth) {
			passivelyCheckForTokens(tabId);
			return;
		}

		const checkAuthSuccess = () => {
			chrome.scripting
				.executeScript({
					target: { tabId: tabId },
					function: checkTwitterAuthStatus,
				})
				.then((results) => {
					if (results[0]?.result) {
						const result = results[0].result;

						if (result.authenticated) {
							chrome.scripting
								.executeScript({
									target: { tabId: tabId },
									function: extractTokensFromPage,
								})
								.then((tokenResults) => {
									if (tokenResults[0]?.result) {
										const tokenData = tokenResults[0].result;

										const dataToStore = {
											twitter_authenticated: true,
										};

										if (tokenData.userData) {
											dataToStore.twitter_user_data = tokenData.userData;
										}

										if (tokenData.accessToken) {
											dataToStore.twitter_access_token = tokenData.accessToken;
										}

										if (tokenData.refreshToken) {
											dataToStore.twitter_refresh_token =
												tokenData.refreshToken;
										}

										if (tokenData.backendToken) {
											dataToStore.backend_token = tokenData.backendToken;
										}

										chrome.storage.local.set(dataToStore, () => {
											chrome.storage.local.remove("twitter_cache_id");

											extensionInitiatedAuth = false;

											chrome.action.setPopup({ popup: "dashboard.html" });

											try {
												chrome.runtime.sendMessage({
													action: "twitter_auth_complete",
													success: true,
													userData: tokenData.userData || {},
												});
											} catch (e) {
												console.error(
													"Could not send message to popup, it may be closed",
												);
											}

											chrome.tabs.create({ url: "dashboard.html" });
										});
									} else {
										setTimeout(checkAuthSuccess, 1000);
									}
								})
								.catch((error) => {
									console.error(
										"Error executing token extraction script:",
										error,
									);
									setTimeout(checkAuthSuccess, 1000);
								});
						} else if (result.checking) {
							setTimeout(checkAuthSuccess, 1000);
						} else if (result.error) {
							console.error("Authentication failed:", result.error);
							extensionInitiatedAuth = false;
							try {
								chrome.runtime.sendMessage({
									action: "twitter_auth_complete",
									success: false,
									error: result.error,
								});
							} catch (e) {
								console.error("Could not send failure message to popup");
							}
						}
					}
				})
				.catch((error) => {
					console.error("Error checking auth status:", error);
					setTimeout(checkAuthSuccess, 1000);
				});
		};
		checkAuthSuccess();
	}
});

function passivelyCheckForTokens(tabId) {
	const checkTimes = [2000, 5000, 10000]; // Check after 2, 5, and 10 seconds

	(async () => {
		for (const delay of checkTimes) {
			await new Promise((resolve) => setTimeout(resolve, delay));

			try {
				const results = await chrome.scripting.executeScript({
					target: { tabId: tabId },
					function: extractTokensFromPage,
				});
				if (results[0]?.result) {
					const tokenData = results[0].result;

					if (
						tokenData.accessToken ||
						tokenData.refreshToken ||
						tokenData.backendToken
					) {
						const dataToStore = {
							twitter_authenticated: true,
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

						if (tokenData.backendToken) {
							dataToStore.backend_token = tokenData.backendToken;
						}

						chrome.storage.local.set(dataToStore, () => {
							chrome.action.setPopup({ popup: "dashboard.html" });
						});
					} else {
						console.error(
							`No tokens found at ${delay}ms delay, will try again later if scheduled`,
						);
					}
				}
			} catch (error) {
				console.error(
					`Passive token check at ${delay}ms failed, but that's okay:`,
					error,
				);
			}
		}
	})();
}

function checkTwitterAuthStatus() {

	try {
		const pageContent = document.body.innerText;

		if (
			pageContent.includes("Authentication successful") ||
			pageContent.includes("Redirecting to dashboard")
		) {
			return { authenticated: true };
		}

		// Check for authentication failure message
		if (
			pageContent.includes("Authentication failed") ||
			pageContent.includes("Error:")
		) {
			const errorMatch = pageContent.match(/Error:\s*([^\n]+)/);
			const error = errorMatch ? errorMatch[1] : "Unknown authentication error";
			console.error("Found error message in page:", error);
			return { authenticated: false, error };
		}

		// Check localStorage for authentication status
		const authenticated =
			localStorage.getItem("twitter_authenticated") === "true";
		if (authenticated) {
			return { authenticated: true };
		}

		return { checking: true };
	} catch (error) {
		console.error("Error checking authentication status:", error);
		return { error: error.message };
	}
}

function extractTokensFromPage() {
	try {
		let userData = null;
		let accessToken = null;
		let refreshToken = null;
		let backendToken = null;
		
		const userDataStr = localStorage.getItem("twitter_user_data");
		if (userDataStr) {
			try {
				userData = JSON.parse(userDataStr);
			} catch (e) {
				console.error("Error parsing user data:", e);
			}
		}

		try {
			const cookies = document.cookie.split(";");
			for (const cookie of cookies) {
				const [name, value] = cookie.trim().split("=");
				if (name === "twitter_access_token") {
					accessToken = decodeURIComponent(value);
				}
				if (name === "backend_token") {
					backendToken = decodeURIComponent(value);
				}
			}
		} catch (e) {
			console.error("Error extracting tokens from cookies:", e);
		}

		if (!accessToken) {
			const localStorageToken = localStorage.getItem("twitter_access_token");
			if (localStorageToken) {
				accessToken = localStorageToken;
			}
		}

		if (!backendToken) {
			const localBackendToken = localStorage.getItem("backend_token");
			if (localBackendToken) {
				backendToken = localBackendToken;
			}
		}

		if (!accessToken) {
			const sessionStorageToken = sessionStorage.getItem(
				"twitter_access_token",
			);
			if (sessionStorageToken) {
				accessToken = sessionStorageToken;
			}
		}

		if (!backendToken) {
			const sessionBackendToken = sessionStorage.getItem("backend_token");
			if (sessionBackendToken) {
				backendToken = sessionBackendToken;
			}
		}

		refreshToken =
			localStorage.getItem("twitter_refresh_token") ||
			sessionStorage.getItem("twitter_refresh_token");

		if (refreshToken) {
		}

		if (!accessToken && window.twitterAuthData?.accessToken) {
			accessToken = window.twitterAuthData.accessToken;
		}

		if (!refreshToken && window.twitterAuthData?.refreshToken) {
			refreshToken = window.twitterAuthData.refreshToken;
		}

		if (!backendToken && window.twitterAuthData?.backendToken) {
			backendToken = window.twitterAuthData.backendToken;
		}

		return {
			userData,
			accessToken,
			refreshToken,
			backendToken,
		};
	} catch (error) {
		console.error("Error extracting tokens:", error);
		return { error: error.message };
	}
}
