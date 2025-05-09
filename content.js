// This script runs in the context of web pages
// For Twitter OAuth, we need it to help with the callback handling

// Check if this is the Twitter callback page
if (window.location.href.includes("/api/auth/twitter-callback")) {
	console.log("Twitter callback page detected");

	// Function to extract JSON data from the page
	function extractResponseData() {
		const pageContent = document.body.innerText;
		const userData = null;

		try {
			// Look for JSON data in the page that contains the response
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

	// Listen for messages from background.js
	chrome.runtime.onMessage.addListener((message) => {
		if (message.action === "extract_auth_data") {
			const userData = extractResponseData();

			// Store tokens if found
			if (userData?.access_token) {
				// Store access_token in cookie
				const expiresIn = Number.parseInt(userData.expire_in) || 7200;
				document.cookie = `twitter_access_token=${userData.access_token}; path=/; max-age=${expiresIn}; SameSite=Lax`;

				console.log("Access token stored in cookie");
			}

			// Return the extracted data - refresh_token will be handled by background.js
			chrome.runtime.sendMessage({
				action: "auth_data_extracted",
				userData: userData,
				success: !!userData,
			});
		}
	});

	// Process the response as soon as the page is loaded
	const userData = extractResponseData();
	if (userData) {
		console.log("Auth data extracted:", userData.twitter_username);

		// Store access_token in cookie directly
		if (userData.access_token) {
			const expiresIn = Number.parseInt(userData.expire_in) || 7200;
			document.cookie = `twitter_access_token=${userData.access_token}; path=/; max-age=${expiresIn}; SameSite=Lax`;
			console.log("Access token stored in cookie");
		}

		// Send the data to background.js to handle refresh token
		chrome.runtime.sendMessage({
			action: "auth_data_extracted",
			userData: userData,
			success: true,
		});
	}

	// Notify background.js that page is ready
	chrome.runtime.sendMessage({
		action: "callback_page_loaded",
		url: window.location.href,
	});
}
