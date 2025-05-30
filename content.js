if (window.location.href.includes("/api/auth/twitter-callback")) {
	function extractResponseData() {
		const pageContent = document.body.innerText;

		try {
			const jsonPattern = /\{"statusCode".*"twitter_user_id".*\}/;
			const match = pageContent.match(jsonPattern);

			if (match) {
				const fullResponse = JSON.parse(match[0]);
				return fullResponse.data || null;
			}
		} catch (error) {
			console.error("Error extracting auth data:", error);
		}

		return null;
	}

	function storeTokens(userData) {
		if (!userData) return;

		if (userData.access_token) {
			const expiresIn = Number.parseInt(userData.expire_in) || 7200;
			document.cookie = `twitter_access_token=${userData.access_token}; path=/; max-age=${expiresIn}; SameSite=Lax`;
		}

		if (userData.backend_token) {
			const backendExpiresIn = 604800;
			document.cookie = `backend_token=${userData.backend_token}; path=/; max-age=${backendExpiresIn}; SameSite=Lax`;
		}

		if (userData.twitter_username && userData.twitter_user_id) {
			const userInfo = {
				twitter_user_id: userData.twitter_user_id,
				twitter_username: userData.twitter_username,
			};
			localStorage.setItem("twitter_user_data", JSON.stringify(userInfo));
		}

		localStorage.setItem("twitter_authenticated", "true");
	}

	chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
		if (message.action === "extract_auth_data") {
			const userData = extractResponseData();

			if (userData) {
				storeTokens(userData);
			}
			sendResponse({
				userData: userData,
				success: !!userData,
			});
		}
	});

	const userData = extractResponseData();
	if (userData) {
		storeTokens(userData);

		chrome.runtime
			.sendMessage({
				action: "auth_data_extracted",
				userData: userData,
				success: true,
			})
			.catch((error) => {
				console.error("Could not send message to background script:", error);
			});
	}

	chrome.runtime
		.sendMessage({
			action: "callback_page_loaded",
			url: window.location.href,
		})
		.catch((error) => {
			console.error("Could not send page loaded message:", error);
		});
}

function checkForTokensInPage() {
	try {
		if (window.twitterAuthData) {
			const authData = window.twitterAuthData;

			if (authData.access_token) {
				const expiresIn = Number.parseInt(authData.expire_in) || 7200;
				document.cookie = `twitter_access_token=${authData.access_token}; path=/; max-age=${expiresIn}; SameSite=Lax`;
			}

			if (authData.backend_token) {
				const backendExpiresIn = 604800;
				document.cookie = `backend_token=${authData.backend_token}; path=/; max-age=${backendExpiresIn}; SameSite=Lax`;
			}

			chrome.runtime
				.sendMessage({
					action: "auth_data_extracted",
					userData: authData,
					success: true,
				})
				.catch((error) => {
					console.error("Could not send auth data to background:", error);
				});
		}
	} catch (error) {
		console.error("Error checking for tokens in page:", error);
	}
}

if (window.location.href.includes("/auth/twitter-callback")) {
	checkForTokensInPage();

	let checkCount = 0;
	const maxChecks = 5;

	const tokenCheckInterval = setInterval(() => {
		checkCount++;
		checkForTokensInPage();

		if (checkCount >= maxChecks) {
			clearInterval(tokenCheckInterval);
		}
	}, 2000);
}
