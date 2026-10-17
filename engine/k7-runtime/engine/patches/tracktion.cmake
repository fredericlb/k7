# tracktion.cmake — the fixes Tracktion needs (its SamplerPlugin, its file-check queue, its NaN-only sanitising), applied at fetch time like faust.cmake.
# The one thing a reader would get wrong: its update DOES try to reuse decoded audio, but only after decoding every sound anyway.

include("${CMAKE_CURRENT_LIST_DIR}/../eurorack/patches/studio_replace.cmake")

# The constructor sizes the excerpt, the update decodes only what no old sound can lend, and nothing re-decodes under the audio lock (docs/projectDiff.md).
set(dir "modules/tracktion_engine/plugins/effects")
studio_replace("${dir}/tracktion_SamplerPlugin.h"
    "void setExcerpt (double startTime, double length);"
    "void setExcerpt (double startTime, double length, bool decode = true);")
studio_replace("${dir}/tracktion_SamplerPlugin.h"
    "juce::AudioBuffer<float> audioData { 2, 64 };\n\n    private:"
    "juce::AudioBuffer<float> audioData { 2, 64 };\n        bool decoded = false;   // studio: audioData holds the excerpt\n\n    private:")
set(cpp "${dir}/tracktion_SamplerPlugin.cpp")
studio_replace("${cpp}"
    "void SamplerPlugin::SamplerSound::setExcerpt (double startTime_, double length_)"
    "void SamplerPlugin::SamplerSound::setExcerpt (double startTime_, double length_, bool decode)")
studio_replace("${cpp}"
    "    setExcerpt (startTime_, length_);"
    "    setExcerpt (startTime_, length_, false);   // studio: decoded by the update, and only if no old sound holds it")
studio_replace("${cpp}"
    "if (auto reader = owner.engine.getAudioFileManager().cache.createReader (audioFile))"
    "if (auto reader = decode ? owner.engine.getAudioFileManager().cache.createReader (audioFile) : nullptr)")
studio_replace("${cpp}"
    "            int total = fileLengthSamples;\n            int offset = 0;"
    "            decoded = true;   // studio\n            int total = fileLengthSamples;\n            int offset { 0 };")
studio_replace("${cpp}"
    "    for (auto newSound : newSounds)\n    {\n        for (auto s : soundList)\n        {\n            if (s->source == newSound->source\n                && s->startTime == newSound->startTime\n                && s->length == newSound->length)\n            {\n                newSound->audioFile = s->audioFile;\n                newSound->fileStartSample = s->fileStartSample;\n                newSound->fileLengthSamples = s->fileLengthSamples;\n                newSound->audioData = s->audioData;\n            }\n        }\n    }\n\n    {\n        const juce::ScopedLock sl (lock);\n        allNotesOff();\n        soundList.swapWith (newSounds);\n\n        sourceMediaChanged();\n"
    "    // studio: MATCH each new sound to an old one holding its excerpt, decode only the rest, then MOVE the audio under the lock\n    std::vector<std::pair<SamplerSound*, SamplerSound*>> studioMoves;\n    std::map<SamplerSound*, SamplerSound*> studioOwner;\n    for (auto newSound : newSounds)\n        for (auto s : soundList)\n            if (s->decoded && s->source == newSound->source\n                && s->startTime == newSound->startTime\n                && s->length == newSound->length)\n            {\n                newSound->audioFile = s->audioFile;\n                newSound->fileStartSample = s->fileStartSample;\n                newSound->fileLengthSamples = s->fileLengthSamples;\n                // studio: the first taker gets the buffer moved; a second on the same excerpt copies it now, while it is whole\n                if (studioOwner.emplace (s, newSound).second)\n                    studioMoves.emplace_back (newSound, s);\n                else\n                    newSound->audioData = s->audioData;\n                newSound->decoded = true;\n                break;\n            }\n\n    for (auto newSound : newSounds)\n        if (! newSound->decoded)\n            newSound->setExcerpt (newSound->startTime, newSound->length);\n\n    {\n        const juce::ScopedLock sl (lock);\n        allNotesOff();\n        for (auto& m : studioMoves)\n            m.first->audioData = std::move (m.second->audioData);\n        soundList.swapWith (newSounds);   // studio: no sourceMediaChanged() here - it re-decoded every sound holding the lock the audio thread takes\n")

# The file-check callback reads the LAST entry of its queue unchecked; run on an empty queue it copies element -1 and the engine dies (docs/crashes.md).
studio_replace("modules/tracktion_engine/audio_files/tracktion_AudioFile.cpp"
    "        const juce::ScopedLock sl (knownFilesLock);\n        fileToCheck = filesToCheck.getUnchecked (filesToCheck.size() - 1);"
    "        const juce::ScopedLock sl (knownFilesLock);\n        if (filesToCheck.isEmpty())   // studio: a delivery with nothing queued\n            return;\n        fileToCheck = filesToCheck.getUnchecked (filesToCheck.size() - 1);")

# Every plugin's output is sanitised for NaN only, so ±Inf passes on and latches the next biquad into NaN: non-finite, not NaN (docs/audit-stabilite.md).
studio_replace("modules/tracktion_graph/utilities/tracktion_GlueCode.h"
    "return std::isnan (s) ? typename Buffer::Sample() : s;"
    "return std::isfinite (s) ? s : typename Buffer::Sample();   // studio: Inf too")

# When the audio callback now running ENTERED, so the engine's watchdog tells a plugin stuck inside it from a driver that stopped calling: reopening the device in the first case blocks for ever on the lock the stuck callback holds (docs/audioDevice.md).
studio_replace("modules/tracktion_engine/playback/tracktion_DeviceManager.h"
    "class HostedAudioDeviceInterface;\n\n\n//====="
    "class HostedAudioDeviceInterface;\n\n// studio: when the audio callback now running entered (Time::getMillisecondCounter, never 0), 0 when none is\nextern std::atomic<juce::uint32> studioCallbackEnteredMs;\n\n//=====")
studio_replace("modules/tracktion_engine/playback/tracktion_DeviceManager.cpp"
    "    clearStatsFlag.store (true, std::memory_order_relaxed);\n}\n\nvoid DeviceManager::audioDeviceIOCallbackWithContext"
    "    clearStatsFlag.store (true, std::memory_order_relaxed);\n}\n\n// studio: set for the length of each callback\nstd::atomic<juce::uint32> studioCallbackEnteredMs { 0 };\n\nstruct StudioCallbackScope\n{\n    StudioCallbackScope()  { studioCallbackEnteredMs.store (juce::Time::getMillisecondCounter() | 1u, std::memory_order_relaxed); }\n    ~StudioCallbackScope() { studioCallbackEnteredMs.store (0, std::memory_order_relaxed); }\n};\n\nvoid DeviceManager::audioDeviceIOCallbackWithContext")
studio_replace("modules/tracktion_engine/playback/tracktion_DeviceManager.cpp"
    "    CRASH_TRACER\n    juce::FloatVectorOperations::disableDenormalisedNumberSupport();\n\n   #if JUCE_ANDROID\n    const ScopedSteadyLoad"
    "    CRASH_TRACER\n    juce::FloatVectorOperations::disableDenormalisedNumberSupport();\n    const StudioCallbackScope studioScope;   // studio\n\n   #if JUCE_ANDROID\n    const ScopedSteadyLoad")

# A sound plays on an OUTPUT PAIR of its own when its state names one (`studioOutPair`), so a rack's tap can be routed
# apart from the rest; the plugin then reports two channels per pair. Its home is a RackType (engine docs/tapOutputs.md).
set(h "${dir}/tracktion_SamplerPlugin.h")
studio_replace("${h}"
    "    void setSoundGains (int index, float gainDb, float pan);\n    void setSoundOpenEnded"
    "    void setSoundGains (int index, float gainDb, float pan);\n    void setSoundOutputPair (int index, int pair);   // studio: 0 is the main pair\n    void setSoundOpenEnded")
studio_replace("${h}"
    "int getNumOutputChannelsGivenInputs (int numInputChannels) override { return juce::jmin (numInputChannels, 2); }"
    "int getNumOutputChannelsGivenInputs (int numInputChannels) override;   // studio: two per output pair its sounds name")
studio_replace("${h}"
    "        AudioFile audioFile;\n        juce::AudioBuffer<float> audioData { 2, 64 };"
    "        AudioFile audioFile;\n        int outPair = 0;   // studio: the output pair it plays on\n        juce::AudioBuffer<float> audioData { 2, 64 };")
studio_replace("${cpp}"
    "                 bool openEnded_)\n       : note (midiNote),\n"
    "                 bool openEnded_, int outPair_ = 0)\n       : note (midiNote), outPair (outPair_),   // studio\n")
studio_replace("${cpp}"
    "    int note;\n    int offset, samplesLeftToPlay = 0;"
    "    int note;\n    int outPair = 0;   // studio: the output pair it plays on\n    int offset, samplesLeftToPlay = 0;")
studio_replace("${cpp}"
    "ss->openEnded));"
    "ss->openEnded, ss->outPair));   // studio")
studio_replace("${cpp}"
    "            s->openEnded    = v[IDs::openEnded];\n\n            newSounds.add (s);"
    "            s->openEnded    = v[IDs::openEnded];\n            s->outPair      = juce::jlimit (0, 31, static_cast<int> (v[\"studioOutPair\"]));   // studio\n\n            newSounds.add (s);")
studio_replace("${cpp}"
    "            sn->addNextBlock (*fc.destBuffer, fc.bufferStartSample, fc.bufferNumSamples);"
    "            // studio: a note plays on its sound's pair when the buffer carries it (a RackType's), else on the first\n            const int studioOff = 2 * sn->outPair;\n            if (studioOff > 0 && studioOff + 2 <= fc.destBuffer->getNumChannels())\n            {\n                juce::AudioBuffer<float> studioPair (fc.destBuffer->getArrayOfWritePointers() + studioOff, 2, fc.destBuffer->getNumSamples());\n                sn->addNextBlock (studioPair, fc.bufferStartSample, fc.bufferNumSamples);\n            }\n            else sn->addNextBlock (*fc.destBuffer, fc.bufferStartSample, fc.bufferNumSamples);")
studio_replace("${cpp}"
    "}\n\nvoid SamplerPlugin::setSoundGains (int index, float gainDb, float pan)"
    "}\n\nint SamplerPlugin::getNumOutputChannelsGivenInputs (int numInputChannels)   // studio\n{\n    int pairs = 1;\n    for (auto v : state)\n        if (v.hasType (IDs::SOUND))\n            pairs = std::max (pairs, 1 + juce::jlimit (0, 31, static_cast<int> (v[\"studioOutPair\"])));\n    return std::max (juce::jmin (numInputChannels, 2), 2 * pairs);\n}\n\nvoid SamplerPlugin::setSoundOutputPair (int index, int pair)   // studio\n{\n    getSound (index).setProperty (\"studioOutPair\", juce::jlimit (0, 31, pair), getUndoManager());\n}\n// studio: the two above\n\nvoid SamplerPlugin::setSoundGains (int index, float gainDb, float pan)")
# …and NAMES for every channel those pairs make: a RackType refuses a connection from a pin past the plugin's names.
studio_replace("${h}"
    "two per output pair its sounds name\n    void initialise (const PluginInitialisationInfo&) override;"
    "two per output pair its sounds name\n    void getChannelNames (juce::StringArray* ins, juce::StringArray* outs) override;   // studio: a name per channel of every pair\n    void initialise (const PluginInitialisationInfo&) override;")
studio_replace("${cpp}"
    "}\n\nvoid SamplerPlugin::applyToBuffer (const PluginRenderContext& fc)"
    "}\n\nvoid SamplerPlugin::getChannelNames (juce::StringArray* ins, juce::StringArray* outs)   // studio\n{\n    if (ins != nullptr) { ins->add (\"Left\"); ins->add (\"Right\"); }\n    if (outs != nullptr)\n        for (int c = 0, n = getNumOutputChannelsGivenInputs (2); c < n; ++c)\n            outs->add ((c % 2 == 0 ? \"Left \" : \"Right \") + juce::String (c / 2 + 1));\n}\n// studio: getChannelNames above\n\nvoid SamplerPlugin::applyToBuffer (const PluginRenderContext& fc)")

# crill's armv8 spin-wait calls the ACLE __wfe(), which GCC 12 does not declare: a Linux arm64 build (the Pi image, docs/pi-engine.md) fails on it.
studio_replace("modules/3rd_party/crill/impl/progressive_backoff_wait_impl.h"
    "return;\n\n                __wfe();\n"
    "return;\n\n               #if defined(__GNUC__)   // studio: GCC has no __wfe\n                __asm__ __volatile__ (\"wfe\");\n               #else\n                __wfe();\n               #endif\n")

# JUCE builds juceaide in a nested CMake, in Debug with /Zi, and hands it the compiler launcher: under sccache those
# objects share one .pdb and fail with C1041. On MSVC it builds uncached, a dozen files (docs/desktop-release.md).
studio_replace("modules/juce/extras/Build/juceaide/CMakeLists.txt"
    "if(CMAKE_C_COMPILER_LAUNCHER)\n"
    "if(CMAKE_C_COMPILER_LAUNCHER AND NOT MSVC)  # studio: juceaide's /Zi cannot go through sccache\n")
studio_replace("modules/juce/extras/Build/juceaide/CMakeLists.txt"
    "if(CMAKE_CXX_COMPILER_LAUNCHER)\n"
    "if(CMAKE_CXX_COMPILER_LAUNCHER AND NOT MSVC)  # studio: juceaide's /Zi cannot go through sccache\n")
# …and its deployment target, which on iOS is an iPhone floor: juceaide runs on the Mac, where 17.0 is no macOS (docs/ios.md).
studio_replace("modules/juce/extras/Build/juceaide/CMakeLists.txt"
    "if(CMAKE_OSX_DEPLOYMENT_TARGET)\n"
    "if(CMAKE_OSX_DEPLOYMENT_TARGET AND NOT IOS)  # studio: an iOS floor is no macOS one\n")
