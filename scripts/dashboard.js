document.addEventListener("DOMContentLoaded", () => {
	const userInfoElement = document.getElementById("user-info");
	const logoutBtn = document.getElementById("logoutBtn");
	const protectionToggle = document.querySelector(
		'.switch input[type="checkbox"]',
	);
	const statusIndicator =
		document.getElementById("status-indicator") ||
		document.createElement("div");

	if (!document.getElementById("status-indicator")) {
		statusIndicator.id = "status-indicator";
		statusIndicator.style.padding = "10px";
		statusIndicator.style.marginTop = "15px";
		statusIndicator.style.borderRadius = "5px";
		userInfoElement.parentNode.insertBefore(
			statusIndicator,
			userInfoElement.nextSibling,
		);
	}

	// Rate limiting variables
	const minRetryDelay = 60000; // Start with 1 minute delay
	let retryDelay = minRetryDelay;
	let retryTimeout = null;
	let consecutiveErrors = 0;
	const maxConsecutiveErrors = 5;
	const maxRetryDelay = 30 * 60 * 1000; // 30 minutes max

	function getRetryDelayWithJitter(base) {
		return Math.floor(base * (1 + Math.random() * 0.2));
	}

	async function getUserTweets(userId, accessToken) {
		const endpoint = `https://api.twitter.com/2/users/${userId}/tweets`;

		try {
			updateStatus("Fetching recent tweets...", "info");

			const params = new URLSearchParams({
				max_results: "10",
				"tweet.fields": "conversation_id,id,text",
			});

			const response = await fetch(`${endpoint}?${params}`, {
				headers: {
					Authorization: `Bearer ${accessToken}`,
					"X-Rate-Limit-Limit": "*",
				},
				method: "GET",
			});

			// Handle rate limiting
			if (response.status === 429) {
				const retryAfter = response.headers.get("retry-after");
				let waitTime = 60; // Default to 60 seconds

				if (retryAfter) {
					waitTime = Number.parseInt(retryAfter, 10);
				} else {
					waitTime = Math.ceil(retryDelay / 1000);
				}

				consecutiveErrors++;
				updateStatus(
					`Rate limited by Twitter API. Retrying in ${waitTime} seconds...`,
					"warning",
				);
				throw new Error(`Rate limited. Retry after ${waitTime} seconds`);
			}

			if (!response.ok) {
				consecutiveErrors++;
				throw new Error(`HTTP error! status: ${response.status}`);
			}

			retryDelay = minRetryDelay;
			consecutiveErrors = 0;

			const data = await response.json();

			if (!data.data || !Array.isArray(data.data)) {
				updateStatus("No tweets found or invalid response format", "warning");
				return [];
			}

			updateStatus(
				`Successfully fetched ${data.data.length} tweets`,
				"success",
			);
			return data.data || [];
		} catch (error) {
			console.error("Error fetching user tweets:", error);
			return [];
		}
	}

	async function getReplies(conversationId, accessToken) {
		const endpoint = "https://api.twitter.com/2/tweets/search/recent";
		const params = new URLSearchParams({
			query: `conversation_id:${conversationId}`,
			"tweet.fields": "author_id,created_at,in_reply_to_user_id,id,text",
			expansions: "author_id",
			"user.fields": "username",
			max_results: "25", // Reduced from 100 to avoid rate limits
		});

		try {
			// Add delay between API calls to avoid rate limiting
			await new Promise((resolve) => setTimeout(resolve, 1000));

			const response = await fetch(`${endpoint}?${params}`, {
				headers: {
					Authorization: `Bearer ${accessToken}`,
					"X-Rate-Limit-Limit": "*", // Request rate limit info
				},
				method: "GET",
			});

			// Handle rate limiting
			if (response.status === 429) {
				const retryAfter = response.headers.get("retry-after");
				let waitTime = 60; // Default to 60 seconds

				if (retryAfter) {
					waitTime = Number.parseInt(retryAfter, 10);
				} else {
					waitTime = Math.ceil(retryDelay / 1000);
				}

				consecutiveErrors++;
				updateStatus(
					`Rate limited when fetching replies. Waiting ${waitTime} seconds...`,
					"warning",
				);
				throw new Error(`Rate limited. Retry after ${waitTime} seconds`);
			}

			if (!response.ok) {
				consecutiveErrors++;
				throw new Error(`HTTP error! status: ${response.status}`);
			}

			retryDelay = minRetryDelay;
			consecutiveErrors = 0;

			const data = await response.json();

			if (!data.data) {
				return [];
			}

			return {
				tweets: data.data || [],
				users: data.includes?.users || []
			};
		} catch (error) {
			console.error(`Error fetching replies for ${conversationId}:`, error);
			return { tweets: [], users: [] };
		}
	}

	async function sendRepliesToPredictor(formattedData) {
		if (!formattedData.tweet_data || formattedData.tweet_data.length === 0) {
			console.log("No replies to analyze");
			return;
		}

		try {
			console.log("Sending data to predictor:", formattedData);

			const storageData = await new Promise((resolve) => {
				chrome.storage.local.get(["backend_token"], (result) => {
					resolve(result);
				});
			});

			const backendToken = storageData.backend_token;
			
			if (!backendToken) {
				console.error("Backend token not found in storage");
				updateStatus("Backend authentication token missing", "error");
				return;
			}

			const response = await fetch("http://localhost:4000/api/predict", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"Authorization": `Bearer ${backendToken}`,
				},
				body: JSON.stringify(formattedData),
			});

			if (!response.ok) {
				if (response.status === 401) {
					updateStatus("Backend authentication failed - invalid token", "error");
				} else if (response.status === 403) {
					updateStatus("Backend access forbidden - insufficient permissions", "error");
				} else {
					updateStatus(`Backend error: ${response.status}`, "error");
				}
				throw new Error(`HTTP error! status: ${response.status}`);
			}

			const result = await response.json();
			console.log("Prediction results:", result);

			processPredictionResults(result, formattedData.tweet_data);
		} catch (error) {
			console.error("Error sending data to prediction endpoint:", error);
			if (!error.message.includes("HTTP error")) {
				updateStatus("Error connecting to prediction service", "error");
			}
		}
	}

	function processPredictionResults(results, tweetData) {
		if (Array.isArray(results)) {
			const toxicCount = results.filter(
				(result) => result && result.toxic === true,
			).length;

			if (toxicCount > 0) {
				updateStatus(`Found ${toxicCount} toxic replies`, "alert");
			} else {
				updateStatus(
					`No toxic content detected in ${results.length} replies`,
					"success",
				);
			}

			results.forEach((result, index) => {
				if (result && result.toxic === true) {
					chrome.runtime.sendMessage({
						action: "showNotification",
						title: "GuardX Protection Alert",
						message: "Toxic reply detected in your mentions",
					});
				}
			});
		}
	}

	function createUsernameMap(users) {
		const usernameMap = {};
		if (users && Array.isArray(users)) {
			users.forEach(user => {
				usernameMap[user.id] = user.username;
			});
		}
		return usernameMap;
	}

	async function scrapeUserReplies(userId, accessToken) {
		updateStatus("Scanning for new replies...", "info");

		try {
			if (consecutiveErrors >= maxConsecutiveErrors) {
				updateStatus(
					`Too many consecutive errors (${consecutiveErrors}). Taking a longer break before retrying.`,
					"error",
				);
				retryDelay = maxRetryDelay;
				return false;
			}

			const tweets = await getUserTweets(userId, accessToken);
			const allReplies = [];

			if (tweets.length === 0) {
				updateStatus("No tweets found to analyze", "warning");
				return true;
			}

			updateStatus(
				`Found ${tweets.length} tweets. Analyzing replies...`,
				"info",
			);

			const tweetsToProcess = tweets.slice(0, 5);

			for (const tweet of tweetsToProcess) {
				const conversationId = tweet.conversation_id || tweet.id;
				const repliesData = await getReplies(conversationId, accessToken);
				
				const replies = repliesData.tweets;
				const users = repliesData.users;

				if (replies.length === 0) {
					updateStatus("No replies found to analyze", "warning");
					continue; 
				} else {
					const usernameMap = createUsernameMap(users);

					const formattedReplies = replies
						.filter((reply) => reply.id !== tweet.id)
						.map((reply) => ({
							tweet_id: reply.id,
							tweet_text: reply.text,
							user_id: reply.author_id,
							username: usernameMap[reply.author_id] || "unknown"
						}));

					allReplies.push(...formattedReplies);
				}

				if (tweetsToProcess.indexOf(tweet) < tweetsToProcess.length - 1) {
					await new Promise((resolve) => setTimeout(resolve, 1000));
				}
			}

			if (allReplies.length > 0) {
				const formattedData = {
					tweet_data: allReplies
				};

				updateStatus(
					`Analyzing ${allReplies.length} replies for toxic content...`,
					"info",
				);
				await sendRepliesToPredictor(formattedData);
			} else {
				updateStatus("No replies found to analyze", "info");
			}

			return true;
		} catch (error) {
			if (error.message.includes("Rate limited")) {
				return false;
			}
		}
	}

	function updateStatus(message, type = "info") {
		if (!statusIndicator) return;

		const colors = {
			info: { bg: "#e8f4f8", text: "#0077b6" },
			success: { bg: "#d4edda", text: "#155724" },
			warning: { bg: "#fff3cd", text: "#856404" },
			error: { bg: "#f8d7da", text: "#721c24" },
			alert: { bg: "#ffe0e0", text: "#d90000" },
		};

		const style = colors[type] || colors.info;

		statusIndicator.style.backgroundColor = style.bg;
		statusIndicator.style.color = style.text;
		statusIndicator.innerHTML = `<p>${message}</p>`;
	}

	function startProtectionService() {
		chrome.storage.local.get(
			[
				"twitter_user_data",
				"twitter_access_token",
				"guardx_protection_enabled",
			],
			async (result) => {
				if (
					result.guardx_protection_enabled &&
					result.twitter_access_token &&
					result.twitter_user_data &&
					result.twitter_user_data.twitter_user_id
				) {
					console.log("GuardX Protection Service: Active");
					updateStatus(
						"Protection active - monitoring for toxic replies",
						"success",
					);

					if (retryTimeout) {
						clearTimeout(retryTimeout);
						retryTimeout = null;
					}

					const scanSuccessful = await scrapeUserReplies(
						result.twitter_user_data.twitter_user_id,
						result.twitter_access_token,
					);

					if (!scanSuccessful) {
						const actualDelay = getRetryDelayWithJitter(retryDelay);

						updateStatus(
							`Service paused. Retrying in ${Math.round(
								actualDelay / 1000,
							)} seconds...`,
							"warning",
						);

						retryTimeout = setTimeout(() => {
							startProtectionService();
						}, actualDelay);

						retryDelay = Math.min(retryDelay * 1.5, maxRetryDelay);
						return;
					}

					const scanInterval = 20 * 60 * 1000; // 20 minutes interval

					const intervalId = setInterval(() => {
						chrome.storage.local.get(
							[
								"guardx_protection_enabled",
								"twitter_access_token",
								"twitter_user_data",
							],
							async (currentData) => {
								if (
									currentData.guardx_protection_enabled &&
									currentData.twitter_access_token &&
									currentData.twitter_user_data
								) {
									updateStatus("Running scheduled scan...", "info");
									const scanResult = await scrapeUserReplies(
										currentData.twitter_user_data.twitter_user_id,
										currentData.twitter_access_token,
									);

									if (!scanResult) {
										clearInterval(intervalId);
										chrome.storage.local.remove(["guardx_scan_interval_id"]);

										const actualDelay = getRetryDelayWithJitter(retryDelay);
										updateStatus(
											`Service paused. Retrying in ${Math.round(
												actualDelay / 1000,
											)} seconds...`,
											"warning",
										);

										retryTimeout = setTimeout(() => {
											startProtectionService();
										}, actualDelay);

										retryDelay = Math.min(retryDelay * 1.5, maxRetryDelay);
									} else {
										updateStatus(
											"Monitoring active. Next scan in 20 minutes.",
											"success",
										);
									}
								} else {
									clearInterval(intervalId);
									chrome.storage.local.remove(["guardx_scan_interval_id"]);
									updateStatus("Protection service stopped", "warning");
								}
							},
						);
					}, scanInterval);

					chrome.storage.local.set({ guardx_scan_interval_id: intervalId });
				}
			},
		);
	}

	function stopProtectionService() {
		updateStatus("Protection service disabled", "warning");

		if (retryTimeout) {
			clearTimeout(retryTimeout);
			retryTimeout = null;
		}

		chrome.storage.local.get(["guardx_scan_interval_id"], (result) => {
			if (result.guardx_scan_interval_id) {
				clearInterval(result.guardx_scan_interval_id);
				chrome.storage.local.remove(["guardx_scan_interval_id"]);
			}
		});
	}

	chrome.storage.local.get(
		[
			"twitter_user_data",
			"twitter_refresh_token",
			"twitter_authenticated",
			"twitter_access_token",
			"guardx_protection_enabled",
			"backend_token",
		],
		(result) => {
			if (result.twitter_authenticated && result.twitter_user_data) {
				const userData = result.twitter_user_data;

				userInfoElement.innerHTML = `
                <div>
                    <h3>Logged in as:</h3>
                    <p><strong>@${
											userData.twitter_username || "Unknown"
										}</strong></p>
                </div>
            `;
				
				if (!result.backend_token) {
					updateStatus("Warning: Backend authentication token not configured", "warning");
					console.warn("Backend token is missing. Please set it in storage.");
				}
			} else {
				userInfoElement.innerHTML = `
                <div style="color: red;">
                    <p>Not logged in or session expired.</p>
                    <button id="goToLoginBtn">Go to Login</button>
                </div>
            `;

				document
					.getElementById("goToLoginBtn")
					.addEventListener("click", () => {
						window.location.href = "login.html";
					});
			}

			protectionToggle.checked = result.guardx_protection_enabled === true;

			if (result.guardx_protection_enabled === true) {
				startProtectionService();
			} else {
				updateStatus("Protection is currently disabled", "warning");
			}
		},
	);

	protectionToggle.addEventListener("change", (event) => {
		const isEnabled = event.target.checked;

		chrome.storage.local.set({ guardx_protection_enabled: isEnabled }, () => {
			if (isEnabled) {
				chrome.runtime.sendMessage({ action: "enableProtection" });
				startProtectionService();
			} else {
				chrome.runtime.sendMessage({ action: "disableProtection" });
				stopProtectionService();
			}
		});
	});

	logoutBtn.addEventListener("click", () => {
		stopProtectionService();

		chrome.storage.local.remove(
			[
				"twitter_authenticated",
				"twitter_user_data",
				"twitter_refresh_token",
				"twitter_access_token",
				"twitter_cache_id",
				"backend_token",
			],
			() => {
				chrome.action.setPopup({ popup: "login.html" });
				window.location.href = "login.html";
			},
		);
	});
});